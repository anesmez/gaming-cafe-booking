import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BookingError,
  toSettingsForm,
  toStoredSettings,
  type BookingErrorCode,
} from "@/lib/booking";
import { algiers, testSettings } from "@/lib/booking/fixtures";
import {
  addStaff,
  createStation,
  getEditableSettings,
  listCustomers,
  listStations,
  listTeam,
  removeStaff,
  saveSettings,
  setCustomerBlocked,
  updateStation,
} from "./admin-config";
import {
  cancelBooking,
  checkInBooking,
  createBooking,
  createClosure,
  deleteCustomer,
  getAvailability,
  listClosures,
  removeClosure,
  requestVenueBooking,
} from "./booking-service";
import { connectDb, disconnectDb } from "./db";
import { Booking } from "./models/booking";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";
import { seed } from "./seed";

/**
 * Milestone 7: the owner changes every default without a deploy. Test hours:
 * open 10:00 to 02:00.
 */

const NOW = algiers("2026-12-01", "12:00");
const DAY = "2026-12-04";
const at = (time: string, date = DAY) => algiers(date, time);
const owner = { role: "owner" as const };
const staff = { role: "staff" as const };
const customer = { role: "customer" as const };

let replSet: MongoMemoryReplSet;
let pcIds: string[];

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-settings-test"));
  await seed("owner@example.com");
  await Settings.updateOne(
    { key: "default" },
    { $set: { openingHours: testSettings().openingHours } },
  );
  pcIds = (
    await Resource.find({ type: "pc" }).sort({ sortOrder: 1 }).lean()
  ).map((r) => String(r._id));
}, 120_000);

afterEach(async () => {
  await Promise.all([Booking.deleteMany({}), SlotLock.deleteMany({})]);
  await Settings.updateOne(
    { key: "default" },
    { $set: { openingHours: testSettings().openingHours } },
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await disconnectDb();
  await replSet?.stop();
});

async function rejects(
  promise: Promise<unknown>,
  code: BookingErrorCode,
  message?: RegExp,
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BookingError);
  expect((error as BookingError).code).toBe(code);
  if (message) expect((error as BookingError).message).toMatch(message);
}

function book(resourceId: string, start = at("18:00"), end = at("20:00")) {
  return createBooking(
    {
      actor: staff,
      start,
      end,
      stations: { mode: "explicit", resourceIds: [resourceId] },
      customer: { name: "Walk-in", phone: "0550000000" },
      source: "phone",
    },
    { now: NOW },
  );
}

describe("settings", () => {
  it("applies new rules to the next booking", async () => {
    const current = (await getEditableSettings())!;
    const form = { ...toSettingsForm(current), stationMaxHours: 2 };
    const stored = toStoredSettings(form, current.slotMinutes);
    if (!stored.ok) throw new Error("invalid");
    await saveSettings(owner, stored.settings);

    await rejects(book(pcIds[0], at("18:00"), at("21:00")), "INVALID_DURATION");
    await book(pcIds[0], at("18:00"), at("20:00"));
    await saveSettings(owner, {
      ...stored.settings,
      station: { ...stored.settings.station, maxMinutes: 360 },
    });
  });

  it("closing a weekday takes it off the public calendar", async () => {
    const current = (await getEditableSettings())!;
    const friday = 5; // 2026-12-04 is a Friday
    await saveSettings(owner, {
      ...current,
      openingHours: current.openingHours.filter((h) => h.weekday !== friday),
    });
    expect((await getAvailability({ date: DAY }, { now: NOW })).open).toBe(
      false,
    );
    await rejects(book(pcIds[0]), "OUTSIDE_HOURS");
  });

  it("only the owner saves settings", async () => {
    const current = (await getEditableSettings())!;
    await rejects(saveSettings(staff, current), "FORBIDDEN");
  });
});

describe("closures", () => {
  it("a venue closure blocks every station, then frees them when removed", async () => {
    const closure = await createClosure(
      { actor: owner, from: DAY, to: DAY, reason: "Aïd" },
      { now: NOW },
    );
    const availability = await getAvailability({ date: DAY }, { now: NOW });
    expect(availability.resources.every((r) => r.free.every((f) => !f))).toBe(
      true,
    );
    await rejects(book(pcIds[0]), "SLOT_TAKEN");
    await rejects(
      requestVenueBooking(
        {
          actor: customer,
          start: at("18:00"),
          end: at("22:00"),
          customer: {
            name: "Team",
            phone: "0550000000",
            email: "t@example.com",
          },
          partySize: 8,
        },
        { now: algiers("2026-12-01", "12:00") },
      ),
      "SLOT_TAKEN",
    );

    expect(await listClosures(NOW)).toEqual([
      expect.objectContaining({
        code: closure.code,
        reason: "Aïd",
        stations: null,
        start: at("10:00"),
        end: at("02:00", "2026-12-05"),
      }),
    ]);

    await removeClosure({ code: closure.code, actor: owner }, { now: NOW });
    expect(await SlotLock.countDocuments()).toBe(0);
    await book(pcIds[0]);
  });

  it("a station closure blocks only that station", async () => {
    await createClosure(
      {
        actor: owner,
        from: DAY,
        to: "2026-12-05",
        resourceId: pcIds[2],
        reason: "Écran cassé",
      },
      { now: NOW },
    );
    const availability = await getAvailability({ date: DAY }, { now: NOW });
    const byId = new Map(availability.resources.map((r) => [r.id, r.free]));
    expect(byId.get(pcIds[2])!.some(Boolean)).toBe(false);
    expect(byId.get(pcIds[3])!.every(Boolean)).toBe(true);
    const [listed] = await listClosures(NOW);
    expect(listed.stations).toHaveLength(1);
  });

  it("cannot be placed over a booking, and is not a booking", async () => {
    const { booking } = await book(pcIds[0]);
    await rejects(
      createClosure(
        { actor: owner, from: DAY, to: DAY, reason: "Aïd" },
        { now: NOW },
      ),
      "SLOT_TAKEN",
    );
    await cancelBooking({ code: booking.code, actor: staff }, { now: NOW });

    const closure = await createClosure(
      { actor: owner, from: DAY, to: DAY, reason: "Aïd" },
      { now: NOW },
    );
    await rejects(
      cancelBooking({ code: closure.code, actor: staff }, { now: NOW }),
      "INVALID_STATE",
    );
    await rejects(
      checkInBooking(
        { code: closure.code, actor: staff },
        { now: at("10:00") },
      ),
      "INVALID_STATE",
    );
    await rejects(
      removeClosure({ code: closure.code, actor: staff }, { now: NOW }),
      "FORBIDDEN",
    );
    await rejects(
      createClosure(
        { actor: staff, from: DAY, to: DAY, reason: "x y" },
        { now: NOW },
      ),
      "FORBIDDEN",
    );
  });

  it("starting today only locks what is left of today", async () => {
    const closure = await createClosure(
      { actor: owner, from: DAY, to: DAY, reason: "Coupure" },
      { now: at("15:10") },
    );
    expect(closure.start).toEqual(at("15:00"));
  });
});

describe("stations", () => {
  it("adds, edits and refuses a duplicate name", async () => {
    await createStation(owner, {
      type: "pc",
      name: "PC 11",
      hourlyRate: 200,
      bookableOnline: true,
      sortOrder: 11,
    });
    await rejects(
      createStation(owner, {
        type: "pc",
        name: "PC 11",
        hourlyRate: 200,
        bookableOnline: true,
        sortOrder: 12,
      }),
      "INVALID_INPUT",
      /NAME_TAKEN/,
    );
    const added = (await listStations(NOW)).find((s) => s.name === "PC 11")!;
    await updateStation(
      owner,
      { ...added, name: "PC 11 VIP", hourlyRate: 300, bookableOnline: false },
      NOW,
    );
    expect(await Resource.findById(added.id).lean()).toMatchObject({
      name: "PC 11 VIP",
      hourlyRate: 300,
      bookableOnline: false,
    });

    await updateStation(
      owner,
      { ...added, name: "PC 11 VIP", active: false },
      NOW,
    );
    expect(
      (await getAvailability({ date: DAY }, { now: NOW })).resources.map(
        (r) => r.id,
      ),
    ).not.toContain(added.id);
    await Resource.deleteOne({ _id: added.id });
  });

  it("will not deactivate a station that has bookings coming", async () => {
    await book(pcIds[1]);
    const station = (await listStations(NOW)).find((s) => s.id === pcIds[1])!;
    expect(station.upcoming).toBe(1);
    await rejects(
      updateStation(owner, { ...station, active: false }, NOW),
      "INVALID_STATE",
      /STATION_IN_USE/,
    );
    await rejects(
      updateStation(staff, { ...station, hourlyRate: 1 }, NOW),
      "FORBIDDEN",
    );
  });
});

describe("team", () => {
  it("adds and removes staff, and never touches the owner", async () => {
    await addStaff(owner, "  Karim@Example.com ");
    await addStaff(owner, "owner@example.com");
    expect((await listTeam()).map((m) => [m.email, m.role])).toEqual([
      ["owner@example.com", "owner"],
      ["karim@example.com", "staff"],
    ]);
    const karim = (await listTeam()).find((m) => m.role === "staff")!;
    await rejects(addStaff(staff, "x@example.com"), "FORBIDDEN");
    await removeStaff(owner, karim.id);
    const ownerId = (await listTeam())[0].id;
    await rejects(removeStaff(owner, ownerId), "NOT_FOUND");
    expect((await User.findById(karim.id).lean())?.role).toBe("customer");
    await User.deleteOne({ _id: karim.id });
  });
});

describe("customers", () => {
  it("lists, blocks, unblocks and deletes a customer", async () => {
    const user = await User.create({
      email: "gamer@example.com",
      name: "Yanis",
      phone: "0551 22 33 44",
      role: "customer",
    });
    const userId = String(user._id);
    const { booking } = await createBooking(
      {
        actor: { role: "customer", userId },
        start: at("18:00"),
        end: at("20:00"),
        stations: { mode: "auto", resourceType: "pc", count: 1 },
        customer: {
          userId,
          name: "Yanis",
          phone: "0551 22 33 44",
          email: "gamer@example.com",
        },
      },
      { now: NOW },
    );

    expect(await listCustomers({ q: "yan" })).toEqual([
      expect.objectContaining({ id: userId, bookings: 1, blocked: false }),
    ]);

    await setCustomerBlocked(staff, userId, true);
    expect(
      (await listCustomers({ blockedOnly: true })).map((c) => c.id),
    ).toEqual([userId]);
    await User.updateOne({ _id: userId }, { $set: { noShowCount: 3 } });
    await setCustomerBlocked(staff, userId, false);
    expect(await User.findById(userId).lean()).toMatchObject({
      blocked: false,
      noShowCount: 0,
    });
    await rejects(setCustomerBlocked(customer, userId, true), "FORBIDDEN");

    await rejects(
      deleteCustomer({ userId, actor: staff }, { now: NOW }),
      "FORBIDDEN",
    );
    await deleteCustomer({ userId, actor: owner }, { now: NOW });
    expect(await User.findById(userId)).toBeNull();
    const after = await Booking.findById(booking._id).lean();
    expect(after).toMatchObject({
      status: "cancelled",
      customer: { name: "Client supprimé", phone: "-" },
    });
    expect(after?.customer.email).toBeUndefined();
    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(0);
  });
});
