import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BookingError, LOCK_HOLDING_STATUSES, type BookingErrorCode } from "@/lib/booking";
import { algiers, testSettings } from "@/lib/booking/fixtures";
import {
  approveVenueBooking,
  cancelBooking,
  createBooking,
  getAvailability,
  getDaySchedule,
  listPendingRequests,
  rejectVenueBooking,
  requestVenueBooking,
} from "./booking-service";
import { connectDb, disconnectDb } from "./db";
import { notify } from "./email/notify";
import { Booking } from "./models/booking";
import { EmailLog } from "./models/email-log";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";
import { seed } from "./seed";

/**
 * Full-venue (LAN) requests against a real MongoDB. Milestone 6 is done when
 * a pending request blocks station bookings and an expired one frees them.
 * Test hours: open 10:00 to 02:00.
 */

const NOW = algiers("2026-12-01", "12:00");
const DAY = "2026-12-04";
const at = (time: string, date = DAY) => algiers(date, time);

const owner = { role: "owner" as const };
const staff = { role: "staff" as const };
const customer = { role: "customer" as const };
const group = { name: "Team Raptors", phone: "0550 11 22 33", email: "raptors@example.com" };

let replSet: MongoMemoryReplSet;
let stationCount: number;
let pcIds: string[];
let ps5Id: string;

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {}); // dev email transport
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-lan-test"));
  await seed("owner@example.com");
  await Settings.updateOne({ key: "default" }, { $set: { openingHours: testSettings().openingHours } });
  const resources = await Resource.find({ active: true }).sort({ sortOrder: 1 }).lean();
  stationCount = resources.length;
  pcIds = resources.filter((r) => r.type === "pc").map((r) => String(r._id));
  ps5Id = String(resources.find((r) => r.type === "console")?._id);
}, 120_000);

afterEach(async () => {
  // Every lock must belong to a booking that still holds slots.
  const locks = await SlotLock.find().lean();
  const holders = await Booking.find({ _id: { $in: locks.map((l) => l.bookingId) } }).lean();
  for (const b of holders) expect(LOCK_HOLDING_STATUSES).toContain(b.status);
  await Promise.all([Booking.deleteMany({}), SlotLock.deleteMany({}), EmailLog.deleteMany({})]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await disconnectDb();
  await replSet?.stop();
});

function request(start = at("18:00"), end = at("22:00"), now = NOW) {
  return requestVenueBooking(
    { actor: customer, start, end, customer: group, partySize: 12, notes: "Tournoi Valorant" },
    { now },
  );
}

function bookStation(resourceId: string, start: Date, end: Date, now = NOW) {
  return createBooking(
    {
      actor: staff,
      stations: { mode: "explicit", resourceIds: [resourceId] },
      start,
      end,
      customer: { name: "Walk-in", phone: "0550000000" },
      source: "walkin",
    },
    { now },
  );
}

async function codeOf(promise: Promise<unknown>): Promise<BookingErrorCode | "OK"> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    if (error instanceof BookingError) return error.code;
    throw error;
  }
}

describe("requesting the venue", () => {
  it("holds every station and the PS5 from the start until after the cleanup", async () => {
    const { booking } = await request();

    expect(booking).toMatchObject({ type: "venue", status: "pending_approval", partySize: 12, notes: "Tournoi Valorant" });
    expect(booking.resourceIds).toHaveLength(stationCount);
    // 18:00 to 22:30 is 9 slots, on every station.
    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(9 * stationCount);
    expect(await SlotLock.countDocuments({ bookingId: booking._id, slotStart: at("22:00") })).toBe(stationCount);
    expect(await SlotLock.countDocuments({ bookingId: booking._id, slotStart: at("22:30") })).toBe(0);
  });

  it("is refused when any single station is taken, and leaves nothing behind", async () => {
    await bookStation(pcIds[7], at("20:00"), at("21:00"));

    expect(await codeOf(request())).toBe("SLOT_TAKEN");
    expect(await Booking.countDocuments({ type: "venue" })).toBe(0);
    expect(await SlotLock.countDocuments()).toBe(2);
  });

  it("refuses a second LAN over the same evening", async () => {
    await request();
    expect(await codeOf(request(at("20:00"), at("23:00")))).toBe("SLOT_TAKEN");
  });

  it("applies the LAN rules: 48 h notice, 3 h minimum, within opening hours", async () => {
    expect(await codeOf(request(at("18:00", "2026-12-02"), at("22:00", "2026-12-02")))).toBe("TOO_SOON");
    expect(await codeOf(request(at("18:00"), at("20:00")))).toBe("INVALID_DURATION");
    expect(await codeOf(request(at("23:00"), at("03:00", "2026-12-05")))).toBe("OUTSIDE_HOURS");
    expect(await SlotLock.countDocuments()).toBe(0);
  });

  it("counts toward the two-upcoming limit like any booking", async () => {
    await User.create({ email: "busy@example.com" });
    const busy = { ...group, email: "busy@example.com" };
    for (const [s, e] of [
      ["12:00", "13:00"],
      ["14:00", "15:00"],
    ]) {
      await createBooking(
        { actor: customer, stations: { mode: "auto", resourceType: "pc" }, start: at(s, "2026-12-02"), end: at(e, "2026-12-02"), customer: busy },
        { now: NOW },
      );
    }
    expect(
      await codeOf(requestVenueBooking({ actor: customer, start: at("18:00"), end: at("22:00"), customer: busy, partySize: 8 }, { now: NOW })),
    ).toBe("LIMIT_REACHED");
  });
});

describe("a pending request blocks station bookings", () => {
  it("for online customers, staff, and the PS5, including during the cleanup", async () => {
    await request();

    expect(
      await codeOf(
        createBooking(
          { actor: customer, stations: { mode: "auto", resourceType: "pc" }, start: at("19:00"), end: at("20:00"), customer: { ...group, email: "x@example.com" } },
          { now: NOW },
        ),
      ),
    ).toBe("SLOT_TAKEN");
    expect(await codeOf(bookStation(pcIds[9], at("21:00"), at("22:00")))).toBe("SLOT_TAKEN");
    expect(await codeOf(bookStation(ps5Id, at("22:00"), at("23:00")))).toBe("SLOT_TAKEN"); // cleanup
    expect(await codeOf(bookStation(ps5Id, at("22:30"), at("23:30")))).toBe("OK");
  });

  it("and shows as busy in public availability and on the staff grid", async () => {
    const { booking } = await request();

    const avail = await getAvailability({ date: DAY, resourceType: "pc", onlineOnly: true }, { now: NOW });
    const i = avail.slotStarts.findIndex((s) => s.getTime() === at("18:00").getTime());
    expect(avail.resources.every((r) => r.free.slice(i, i + 9).every((f) => !f))).toBe(true);

    const grid = await getDaySchedule(DAY, { now: NOW });
    expect(grid.rows.every((r) => r.slots[i] === String(booking._id))).toBe(true);
    expect(grid.bookings[String(booking._id)].status).toBe("pending_approval");
  });
});

describe("the owner's decision", () => {
  it("approves with a price: confirmed, slots still held", async () => {
    const { booking } = await request();

    const approved = await approveVenueBooking(
      { code: booking.code, actor: owner, quotedPrice: 15000, note: "Clavier perso autorisé" },
      { now: at("09:00", "2026-12-02") },
    );

    expect(approved).toMatchObject({ status: "confirmed", quotedPrice: 15000 });
    expect(approved.history.at(-1)).toMatchObject({ from: "pending_approval", to: "confirmed", by: "owner", note: "Clavier perso autorisé" });
    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(9 * stationCount);
  });

  it("rejects: every slot is freed at once", async () => {
    const { booking } = await request();

    const rejected = await rejectVenueBooking({ code: booking.code, actor: owner }, { now: NOW });

    expect(rejected.status).toBe("rejected");
    expect(await SlotLock.countDocuments()).toBe(0);
    expect(await codeOf(bookStation(pcIds[0], at("19:00"), at("20:00")))).toBe("OK");
  });

  it("is the owner's alone, and only once", async () => {
    const { booking } = await request();

    expect(await codeOf(approveVenueBooking({ code: booking.code, actor: staff }, { now: NOW }))).toBe("FORBIDDEN");
    expect(await codeOf(rejectVenueBooking({ code: booking.code, actor: customer }, { now: NOW }))).toBe("FORBIDDEN");

    await approveVenueBooking({ code: booking.code, actor: owner }, { now: NOW });
    expect(await codeOf(rejectVenueBooking({ code: booking.code, actor: owner }, { now: NOW }))).toBe("INVALID_STATE");
  });

  it("cannot decide a station booking", async () => {
    const { booking } = await bookStation(pcIds[0], at("19:00"), at("20:00"));
    expect(await codeOf(approveVenueBooking({ code: booking.code, actor: owner }, { now: NOW }))).toBe("INVALID_STATE");
  });
});

describe("expiry after 24 hours without an answer", () => {
  it("keeps blocking until the deadline, then frees everything", async () => {
    const { booking } = await request();
    const almost = algiers("2026-12-02", "11:59");
    const deadline = algiers("2026-12-02", "12:00");

    expect(await codeOf(bookStation(pcIds[0], at("19:00"), at("20:00"), almost))).toBe("SLOT_TAKEN");
    expect((await Booking.findById(booking._id).lean())?.status).toBe("pending_approval");

    // The next booking attempt after the deadline expires it first, then succeeds.
    expect(await codeOf(bookStation(pcIds[0], at("19:00"), at("20:00"), deadline))).toBe("OK");

    const expired = await Booking.findById(booking._id).lean();
    expect(expired?.status).toBe("expired");
    expect(expired?.history.at(-1)).toMatchObject({ from: "pending_approval", to: "expired", by: "system" });
    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(0);
  });

  it("also expires on a mere availability read, so customers see the venue free", async () => {
    await request();

    const day = await getAvailability({ date: DAY, resourceType: "pc", onlineOnly: true }, { now: algiers("2026-12-02", "12:30") });

    expect(day.resources.every((r) => r.free.every(Boolean))).toBe(true);
  });

  it("can no longer be approved once expired", async () => {
    const { booking } = await request();
    expect(
      await codeOf(approveVenueBooking({ code: booking.code, actor: owner }, { now: algiers("2026-12-02", "12:00") })),
    ).toBe("INVALID_STATE");
  });

  it("lists pending requests oldest first, with their deadline", async () => {
    const first = await request(at("12:00"), at("15:00"), NOW);
    const second = await request(at("18:00"), at("22:00"), algiers("2026-12-01", "13:00"));

    const list = await listPendingRequests(algiers("2026-12-01", "14:00"));

    expect(list.map((r) => r.code)).toEqual([first.booking.code, second.booking.code]);
    expect(list[0].expiresAt).toEqual(algiers("2026-12-02", "12:00"));
    expect(list[0]).toMatchObject({ customerName: "Team Raptors", partySize: 12 });
  });
});

describe("customer cancellation", () => {
  it("is possible until 48 hours before the LAN", async () => {
    const { booking } = await request(at("18:00", "2026-12-05"), at("22:00", "2026-12-05"));

    expect(await codeOf(cancelBooking({ code: booking.code, actor: customer }, { now: algiers("2026-12-03", "18:01") }))).toBe(
      "CUTOFF_PASSED",
    );
    expect(await codeOf(cancelBooking({ code: booking.code, actor: customer }, { now: algiers("2026-12-03", "18:00") }))).toBe("OK");
    expect(await SlotLock.countDocuments()).toBe(0);
  });
});

describe("LAN emails", () => {
  it("tells the customer and the owner about a request, once", async () => {
    const { booking, manageToken } = await request();

    await notify({ type: "lan_requested", booking, manageToken }, { now: NOW });
    await notify({ type: "lan_requested", booking, manageToken }, { now: NOW });

    const rows = await EmailLog.find({ bookingId: booking._id }).sort({ template: 1 }).lean();
    expect(rows.map((r) => [r.template, r.to, r.status])).toEqual([
      ["lan_request_owner", "owner@example.com", "sent"],
      ["lan_requested", "raptors@example.com", "sent"],
    ]);
  });

  it("tells the customer the decision", async () => {
    const { booking } = await request();
    const approved = await approveVenueBooking({ code: booking.code, actor: owner, quotedPrice: 12000 }, { now: NOW });

    expect((await notify({ type: "lan_decided", booking: approved, decision: "approved" }, { now: NOW })).status).toBe("sent");
    expect(await EmailLog.findOne({ bookingId: booking._id, template: "lan_approved" }).lean()).toMatchObject({
      to: "raptors@example.com",
      status: "sent",
    });
  });
});
