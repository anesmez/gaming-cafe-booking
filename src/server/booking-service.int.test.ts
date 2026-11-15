import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BOOKING_CODE_RE, BookingError, LOCK_HOLDING_STATUSES, type BookingErrorCode } from "@/lib/booking";
import { algiers, testSettings } from "@/lib/booking/fixtures";
import {
  cancelBooking,
  createBooking,
  getAvailability,
  getBookingByCode,
  moveBooking,
  verifyManageToken,
  type CreateBookingInput,
} from "./booking-service";
import { connectDb, disconnectDb } from "./db";
import { Booking } from "./models/booking";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";
import { seed } from "./seed";

/**
 * The booking engine against a real MongoDB replica set (transactions need
 * one). Seeded like production (10 PCs, of which PC 01–05 are bookable online,
 * one PS5, Africa/Algiers) but with fixed test hours: open 10:00 to 02:00.
 */

const DAY = "2026-12-02"; // a Wednesday
const NOW = algiers("2026-12-01", "12:00");
const at = (time: string, date = DAY) => algiers(date, time);

const staff = { role: "staff" as const };
const customer = { role: "customer" as const };
const player = (n: number) => ({
  name: `Player ${n}`,
  phone: "0550000000",
  email: `player${n}@example.com`,
});

let replSet: MongoMemoryReplSet;
let pcIds: string[]; // by sortOrder: index 0 is PC 01
let ps5Id: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-engine-test"));
  await seed("owner@example.com");
  // Fixed test hours, independent of the venue's real ones in the seed.
  await Settings.updateOne({ key: "default" }, { $set: { openingHours: testSettings().openingHours } });

  const pcs = await Resource.find({ type: "pc" }).sort({ sortOrder: 1 }).lean();
  pcIds = pcs.map((r) => String(r._id));
  ps5Id = String((await Resource.findOne({ type: "console" }).lean())?._id);
}, 120_000);

afterEach(async () => {
  await expectLocksMatchBookings();
  await Promise.all([
    Booking.deleteMany({}),
    SlotLock.deleteMany({}),
    User.deleteMany({ role: { $ne: "owner" } }),
  ]);
});

afterAll(async () => {
  await disconnectDb();
  await replSet?.stop();
});

/** Books explicit stations as staff. */
function book(resourceIds: string[], start: Date, end: Date, overrides: Partial<CreateBookingInput> = {}) {
  return createBooking(
    {
      actor: staff,
      stations: { mode: "explicit", resourceIds },
      start,
      end,
      customer: player(0),
      source: "phone",
      ...overrides,
    },
    { now: NOW },
  );
}

/** Books `count` auto-assigned stations as an online customer. */
function bookOnline(n: number, start: Date, end: Date, count = 1, type: "pc" | "console" = "pc") {
  return createBooking(
    {
      actor: customer,
      stations: { mode: "auto", resourceType: type, count },
      start,
      end,
      customer: player(n),
    },
    { now: NOW },
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

/**
 * The invariant behind the whole product: every lock belongs to a booking that
 * still holds slots, and covers exactly a (station, slot) pair of that booking.
 */
async function expectLocksMatchBookings() {
  const [locks, bookings] = await Promise.all([SlotLock.find().lean(), Booking.find().lean()]);
  const byId = new Map(bookings.map((b) => [String(b._id), b]));

  for (const lock of locks) {
    const booking = byId.get(String(lock.bookingId));
    expect(booking, `lock without booking: ${lock.slotStart.toISOString()}`).toBeDefined();
    expect(LOCK_HOLDING_STATUSES).toContain(booking?.status);
    expect(booking?.resourceIds.map(String)).toContain(String(lock.resourceId));
    expect(lock.slotStart >= booking!.start && lock.slotStart < booking!.end).toBe(true);
  }

  const keys = locks.map((l) => `${l.resourceId}:${l.slotStart.getTime()}`);
  expect(new Set(keys).size).toBe(keys.length);
}

describe("createBooking", () => {
  it("confirms the booking and locks every slot of every station", async () => {
    const { booking, manageToken } = await book([pcIds[0], pcIds[1]], at("18:00"), at("20:00"));

    expect(booking).toMatchObject({ type: "station", status: "confirmed", source: "phone", priceEstimate: 0 });
    expect(booking.code).toMatch(BOOKING_CODE_RE);
    expect(booking.resourceIds.map(String).sort()).toEqual([pcIds[0], pcIds[1]].sort());
    expect(booking.history).toHaveLength(1);
    expect(booking.history[0]).toMatchObject({ from: null, to: "confirmed", by: "staff" });
    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(8); // 2 stations x 4 slots

    expect(verifyManageToken(booking, manageToken)).toBe(true);
    expect(verifyManageToken(booking, "not-the-token")).toBe(false);
    expect(booking.manageTokenHash).not.toContain(manageToken);
  });

  it("lets exactly one of 50 simultaneous requests for the same station and slot through", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => book([pcIds[0]], at("18:00"), at("19:00"))),
    );

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(49);
    for (const { reason } of lost) {
      expect(reason).toBeInstanceOf(BookingError);
      expect(reason.code).toBe("SLOT_TAKEN");
    }

    expect(await Booking.countDocuments()).toBe(1);
    expect(await SlotLock.countDocuments()).toBe(2);
  });

  it("seats 50 simultaneous online customers on the 5 online PCs, one each, and turns the rest away", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, n) => bookOnline(n, at("18:00"), at("19:00"))),
    );

    const won = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.booking] : []));
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(5);
    expect(lost.map((r) => r.reason.code)).toEqual(Array(45).fill("SLOT_TAKEN"));

    const seats = won.flatMap((b) => b.resourceIds.map(String));
    expect(new Set(seats).size).toBe(5);
    expect(seats.sort()).toEqual(pcIds.slice(0, 5).sort());
    expect(await SlotLock.countDocuments()).toBe(10);
  });

  it("rejects a partial overlap and leaves nothing behind", async () => {
    const first = await book([pcIds[0]], at("18:00"), at("20:00"));

    expect(await codeOf(book([pcIds[0], pcIds[1]], at("19:00"), at("21:00")))).toBe("SLOT_TAKEN");

    expect(await Booking.countDocuments()).toBe(1);
    expect(await SlotLock.countDocuments()).toBe(4);
    expect(await SlotLock.countDocuments({ bookingId: first.booking._id })).toBe(4);
    // PC 02 was only in the failed request: it must still be free.
    expect(await SlotLock.countDocuments({ resourceId: pcIds[1] })).toBe(0);
  });

  it("allows back-to-back bookings on the same station", async () => {
    await book([pcIds[0]], at("18:00"), at("20:00"));
    expect(await codeOf(book([pcIds[0]], at("20:00"), at("21:00")))).toBe("OK");
    expect(await codeOf(book([pcIds[0]], at("17:00"), at("18:00")))).toBe("OK");
  });

  it("seats a group side by side and works around a taken station", async () => {
    const sortOrders = async (ids: unknown[]) =>
      (await Resource.find({ _id: { $in: ids } }).sort({ sortOrder: 1 }).lean()).map((r) => r.sortOrder);

    const trio = await bookOnline(1, at("18:00"), at("19:00"), 3);
    expect(await sortOrders(trio.booking.resourceIds)).toEqual([1, 2, 3]);

    // Another evening: PC 02 is taken, so the only run of three is PC 03–05.
    await book([pcIds[1]], at("21:00"), at("22:00"));
    const second = await bookOnline(2, at("21:00"), at("22:00"), 3);
    expect(await sortOrders(second.booking.resourceIds)).toEqual([3, 4, 5]);
  });

  it("keeps walk-in stations away from online customers but not from staff", async () => {
    await bookOnline(1, at("18:00"), at("19:00"), 5);
    expect(await codeOf(bookOnline(2, at("18:00"), at("19:00")))).toBe("SLOT_TAKEN");

    const walkIn = await createBooking(
      {
        actor: staff,
        stations: { mode: "auto", resourceType: "pc", count: 1 },
        start: at("18:00"),
        end: at("19:00"),
        customer: { name: "Walk-in", phone: "0550000000" },
        source: "walkin",
      },
      { now: NOW },
    );
    expect(pcIds.indexOf(String(walkIn.booking.resourceIds[0]))).toBeGreaterThanOrEqual(5);
    expect(walkIn.booking.customer.email).toBeUndefined();
  });

  it("books the PS5 once per slot", async () => {
    const first = await bookOnline(1, at("18:00"), at("19:00"), 1, "console");
    expect(first.booking.resourceIds.map(String)).toEqual([ps5Id]);
    expect(await codeOf(bookOnline(2, at("18:30"), at("19:30"), 1, "console"))).toBe("SLOT_TAKEN");
  });

  it("accepts a session after midnight and files it under the previous business day", async () => {
    await bookOnline(1, at("00:00", "2026-12-03"), at("01:30", "2026-12-03"));

    const day = await getAvailability({ date: DAY, resourceType: "pc" });
    expect(day.slotStarts).toHaveLength(32); // 10:00 to 02:00
    const midnight = day.slotStarts.findIndex((s) => s.getTime() === at("00:00", "2026-12-03").getTime());
    expect(midnight).toBe(28);

    const pc01 = day.resources[0];
    expect(pc01.free.slice(midnight, midnight + 4)).toEqual([false, false, false, true]);
    expect(pc01.free.slice(0, midnight).every(Boolean)).toBe(true);
  });

  it("enforces the booking rules before touching any slot", async () => {
    expect(await codeOf(bookOnline(1, at("01:00", "2026-12-03"), at("03:00", "2026-12-03")))).toBe("OUTSIDE_HOURS");
    expect(await codeOf(bookOnline(1, at("08:00"), at("10:00")))).toBe("OUTSIDE_HOURS");
    expect(await codeOf(bookOnline(1, at("12:00", "2026-12-01"), at("13:00", "2026-12-01")))).toBe("TOO_SOON");
    expect(await codeOf(bookOnline(1, at("18:00", "2026-12-20"), at("19:00", "2026-12-20")))).toBe("TOO_FAR");
    expect(await codeOf(bookOnline(1, at("18:00"), at("18:30")))).toBe("INVALID_DURATION");
    expect(await codeOf(bookOnline(1, at("18:10"), at("19:10")))).toBe("INVALID_INPUT");
    expect(await codeOf(bookOnline(1, at("18:00"), at("19:00"), 6))).toBe("TOO_MANY_STATIONS");

    expect(await Booking.countDocuments()).toBe(0);
    expect(await SlotLock.countDocuments()).toBe(0);
  });

  it("stops a customer at two upcoming bookings until one is cancelled", async () => {
    const first = await bookOnline(1, at("14:00"), at("15:00"));
    await bookOnline(1, at("16:00"), at("17:00"));
    expect(await codeOf(bookOnline(1, at("18:00"), at("19:00")))).toBe("LIMIT_REACHED");

    // The address is matched whatever its casing.
    const shouting = { ...player(1), email: "PLAYER1@Example.com" };
    expect(
      await codeOf(
        createBooking(
          { actor: customer, stations: { mode: "auto", resourceType: "pc" }, start: at("18:00"), end: at("19:00"), customer: shouting },
          { now: NOW },
        ),
      ),
    ).toBe("LIMIT_REACHED");

    await cancelBooking({ code: first.booking.code, actor: customer }, { now: NOW });
    expect(await codeOf(bookOnline(1, at("18:00"), at("19:00")))).toBe("OK");
  });

  it("refuses blocked customers and customers with three no-shows", async () => {
    await User.create({ email: player(1).email, blocked: true });
    await User.create({ email: player(2).email, noShowCount: 3 });

    expect(await codeOf(bookOnline(1, at("18:00"), at("19:00")))).toBe("BLOCKED");
    expect(await codeOf(bookOnline(2, at("18:00"), at("19:00")))).toBe("BLOCKED");
    expect(await codeOf(bookOnline(3, at("18:00"), at("19:00")))).toBe("OK");
  });

  it("does not let customers pick stations or book without an email", async () => {
    expect(await codeOf(book([pcIds[7]], at("18:00"), at("19:00"), { actor: customer }))).toBe("FORBIDDEN");
    expect(
      await codeOf(
        createBooking(
          {
            actor: customer,
            stations: { mode: "auto", resourceType: "pc" },
            start: at("18:00"),
            end: at("19:00"),
            customer: { name: "No Mail", phone: "0550000000" },
          },
          { now: NOW },
        ),
      ),
    ).toBe("INVALID_INPUT");
  });

  it("refuses unknown or inactive stations", async () => {
    expect(await codeOf(book(["0123456789abcdef01234567"], at("18:00"), at("19:00")))).toBe("NOT_FOUND");

    await Resource.updateOne({ _id: pcIds[9] }, { active: false });
    try {
      expect(await codeOf(book([pcIds[9]], at("18:00"), at("19:00")))).toBe("NOT_FOUND");
    } finally {
      await Resource.updateOne({ _id: pcIds[9] }, { active: true });
    }
  });
});

describe("cancelBooking", () => {
  it("cancels, records who did it and frees the slots for someone else", async () => {
    const { booking } = await bookOnline(1, at("18:00"), at("20:00"));

    const cancelled = await cancelBooking(
      { code: booking.code.toLowerCase(), actor: customer, note: "plans changed" },
      { now: NOW },
    );

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.history).toHaveLength(2);
    expect(cancelled.history[1]).toMatchObject({ from: "confirmed", to: "cancelled", by: "customer", note: "plans changed" });
    expect(await SlotLock.countDocuments()).toBe(0);
    expect(await codeOf(book(booking.resourceIds.map(String), at("18:00"), at("20:00")))).toBe("OK");
  });

  it("holds customers to the 2-hour cutoff but not staff", async () => {
    const { booking } = await bookOnline(1, at("18:00"), at("20:00"));
    const late = { now: at("16:30") };

    expect(await codeOf(cancelBooking({ code: booking.code, actor: customer }, late))).toBe("CUTOFF_PASSED");
    expect(await SlotLock.countDocuments()).toBe(4);
    expect((await getBookingByCode(booking.code)).status).toBe("confirmed");

    expect(await codeOf(cancelBooking({ code: booking.code, actor: staff }, late))).toBe("OK");
    expect(await SlotLock.countDocuments()).toBe(0);
  });

  it("lets staff cancel mid-session and frees the rest of it at once", async () => {
    const day = "2026-12-01";
    const { booking } = await book([pcIds[0]], at("12:00", day), at("14:00", day));
    const midSession = { now: at("13:10", day) };

    await cancelBooking({ code: booking.code, actor: staff }, midSession);

    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(0);
    // The slot that is running can be given to a walk-in straight away.
    expect(
      await codeOf(
        createBooking(
          {
            actor: staff,
            stations: { mode: "explicit", resourceIds: [pcIds[0]] },
            start: at("13:00", day),
            end: at("14:00", day),
            customer: { name: "Walk-in", phone: "0550000000" },
            source: "walkin",
          },
          midSession,
        ),
      ),
    ).toBe("OK");
  });

  it("refuses a second cancellation and an unknown code", async () => {
    const { booking } = await bookOnline(1, at("18:00"), at("20:00"));
    await cancelBooking({ code: booking.code, actor: customer }, { now: NOW });

    expect(await codeOf(cancelBooking({ code: booking.code, actor: staff }, { now: NOW }))).toBe("INVALID_STATE");
    expect(await codeOf(cancelBooking({ code: "GC-ZZZZ", actor: staff }, { now: NOW }))).toBe("NOT_FOUND");
  });

  it("cancels once when two cancellations race", async () => {
    const { booking } = await bookOnline(1, at("18:00"), at("20:00"));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => cancelBooking({ code: booking.code, actor: staff }, { now: NOW })),
    );

    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const after = await getBookingByCode(booking.code);
    expect(after.history.filter((h) => h.to === "cancelled")).toHaveLength(1);
    expect(await SlotLock.countDocuments()).toBe(0);
  });
});

describe("moveBooking", () => {
  it("moves a booking, including onto part of its own old range", async () => {
    const { booking } = await book([pcIds[0]], at("18:00"), at("20:00"));

    const moved = await moveBooking(
      { code: booking.code, actor: staff, start: at("19:00"), end: at("21:00") },
      { now: NOW },
    );

    expect(moved.start).toEqual(at("19:00"));
    expect(moved.end).toEqual(at("21:00"));
    expect(moved.status).toBe("confirmed");
    expect(moved.history).toHaveLength(2);
    expect(moved.history[1].note).toContain("moved from");

    const locks = await SlotLock.find({ bookingId: booking._id }).sort({ slotStart: 1 }).lean();
    expect(locks.map((l) => l.slotStart)).toEqual([at("19:00"), at("19:30"), at("20:00"), at("20:30")]);
    expect(await codeOf(book([pcIds[0]], at("18:00"), at("19:00")))).toBe("OK");
  });

  it("moves a booking to another station", async () => {
    const { booking } = await book([pcIds[0]], at("18:00"), at("20:00"));

    const moved = await moveBooking(
      { code: booking.code, actor: staff, start: at("18:00"), end: at("20:00"), resourceIds: [pcIds[2]] },
      { now: NOW },
    );

    expect(moved.resourceIds.map(String)).toEqual([pcIds[2]]);
    expect(await SlotLock.countDocuments({ resourceId: pcIds[0] })).toBe(0);
    expect(await SlotLock.countDocuments({ resourceId: pcIds[2] })).toBe(4);
  });

  it("leaves the booking exactly where it was when the new time is taken", async () => {
    const { booking } = await book([pcIds[0]], at("18:00"), at("20:00"));
    await book([pcIds[0]], at("20:30"), at("21:30"), { customer: player(9) });

    expect(
      await codeOf(moveBooking({ code: booking.code, actor: staff, start: at("19:00"), end: at("21:00") }, { now: NOW })),
    ).toBe("SLOT_TAKEN");

    const after = await getBookingByCode(booking.code);
    expect(after.start).toEqual(at("18:00"));
    expect(after.end).toEqual(at("20:00"));
    expect(after.history).toHaveLength(1);
    const locks = await SlotLock.find({ bookingId: booking._id }).sort({ slotStart: 1 }).lean();
    expect(locks.map((l) => l.slotStart)).toEqual([at("18:00"), at("18:30"), at("19:00"), at("19:30")]);
  });

  it("is refused for customers, cancelled bookings and times outside opening hours", async () => {
    const { booking } = await bookOnline(1, at("18:00"), at("20:00"));
    const target = { code: booking.code, start: at("20:00"), end: at("22:00") };

    expect(await codeOf(moveBooking({ ...target, actor: customer }, { now: NOW }))).toBe("FORBIDDEN");
    expect(
      await codeOf(moveBooking({ code: booking.code, actor: staff, start: at("07:00"), end: at("09:00") }, { now: NOW })),
    ).toBe("OUTSIDE_HOURS");

    await cancelBooking({ code: booking.code, actor: staff }, { now: NOW });
    expect(await codeOf(moveBooking({ ...target, actor: staff }, { now: NOW }))).toBe("INVALID_STATE");
  });
});

describe("getAvailability", () => {
  it("shows every slot free on an empty day", async () => {
    const day = await getAvailability({ date: DAY });

    expect(day).toMatchObject({ date: DAY, timezone: "Africa/Algiers", slotMinutes: 30, open: true });
    expect(day.opensAt).toEqual(at("10:00"));
    expect(day.closesAt).toEqual(at("02:00", "2026-12-03"));
    expect(day.resources.map((r) => r.name)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `PC ${String(i + 1).padStart(2, "0")}`),
      "PS5",
    ]);
    expect(day.resources.every((r) => r.free.length === 32 && r.free.every(Boolean))).toBe(true);
  });

  it("marks exactly the booked slots of the booked station", async () => {
    await book([pcIds[3]], at("18:00"), at("19:30"));

    const day = await getAvailability({ date: DAY, resourceType: "pc" });
    const first = day.slotStarts.findIndex((s) => s.getTime() === at("18:00").getTime());

    const pc04 = day.resources[3];
    expect(pc04.free.filter((f) => !f)).toHaveLength(3);
    expect(pc04.free.slice(first, first + 3)).toEqual([false, false, false]);
    expect(day.resources.filter((r) => r.name !== "PC 04").every((r) => r.free.every(Boolean))).toBe(true);
  });

  it("hides walk-in stations from the public view", async () => {
    const day = await getAvailability({ date: DAY, resourceType: "pc", onlineOnly: true });
    expect(day.resources.map((r) => r.name)).toEqual(["PC 01", "PC 02", "PC 03", "PC 04", "PC 05"]);
  });

  it("rejects a malformed date", async () => {
    expect(await codeOf(getAvailability({ date: "02/12/2026" }))).toBe("INVALID_INPUT");
    expect(await codeOf(getAvailability({ date: "2026-02-30" }))).toBe("INVALID_INPUT");
  });
});
