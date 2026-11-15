import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { algiers } from "@/lib/booking/fixtures";
import { connectDb, disconnectDb } from "./db";
import { Booking } from "./models/booking";
import { EmailLog } from "./models/email-log";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";
import { cancelManagedBooking, loadManagedBooking, placeOnlineBooking } from "./public-booking";
import { seed } from "./seed";
import type { SessionUser } from "./session";

/**
 * The public booking flow below the pages: booking as a logged-in customer,
 * and who may see or cancel a booking from its page. Real MongoDB; venue hours
 * from the seed (16:00 to 04:00).
 */

const NOW = algiers("2026-12-01", "12:00");
const START = algiers("2026-12-02", "18:00").toISOString();

let replSet: MongoMemoryReplSet;
let alice: SessionUser;
let bob: SessionUser;
let staff: SessionUser;

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {}); // dev email transport prints here
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-public-test"));
  await seed("owner@example.com");

  const make = async (email: string, role: SessionUser["role"]) => {
    const user = await User.create({ email, role });
    return { id: String(user._id), email, name: "", role };
  };
  alice = await make("alice@example.com", "customer");
  bob = await make("bob@example.com", "customer");
  staff = await make("staff@example.com", "staff");
}, 120_000);

afterEach(async () => {
  await Promise.all([Booking.deleteMany({}), SlotLock.deleteMany({}), EmailLog.deleteMany({})]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await disconnectDb();
  await replSet?.stop();
});

const input = (overrides = {}) => ({
  resourceType: "pc" as const,
  start: START,
  durationMinutes: 120,
  count: 2,
  name: "Alice",
  phone: "0550 12 34 56",
  ...overrides,
});

async function aliceBooks(overrides = {}) {
  const result = await placeOnlineBooking(alice, input(overrides), NOW);
  if (!result.ok) throw new Error(`booking failed: ${result.error}`);
  return result;
}

describe("placeOnlineBooking", () => {
  it("books adjacent stations under the customer's account and emails the confirmation", async () => {
    const { code } = await aliceBooks();

    const booking = await Booking.findOne({ code }).lean();
    expect(booking).toMatchObject({
      status: "confirmed",
      source: "online",
      customer: { name: "Alice", phone: "0550 12 34 56", email: "alice@example.com" },
    });
    expect(String(booking?.customer.userId)).toBe(alice.id);
    expect(booking?.resourceIds).toHaveLength(2);
    expect(booking?.end).toEqual(algiers("2026-12-02", "20:00"));

    expect(await EmailLog.findOne({ bookingId: booking?._id }).lean()).toMatchObject({
      template: "booking_confirmed",
      to: "alice@example.com",
      status: "sent",
    });
  });

  it("remembers name and phone for next time", async () => {
    await aliceBooks({ name: "Alice B", phone: "0661 00 00 00" });
    expect(await User.findById(alice.id).lean()).toMatchObject({ name: "Alice B", phone: "0661 00 00 00" });
  });

  it("always books exactly one PS5", async () => {
    const { code } = await aliceBooks({ resourceType: "console", count: 4 });
    expect((await Booking.findOne({ code }).lean())?.resourceIds).toHaveLength(1);
  });

  it("returns the engine's error code instead of throwing", async () => {
    await aliceBooks({ count: 5 }); // all five online PCs
    expect(await placeOnlineBooking(bob, input({ name: "Bob", count: 1 }), NOW)).toEqual({
      ok: false,
      error: "SLOT_TAKEN",
    });
    // Opening is 16:00: 14:00 is outside hours.
    expect(await placeOnlineBooking(bob, input({ start: algiers("2026-12-02", "14:00").toISOString() }), NOW)).toEqual({
      ok: false,
      error: "OUTSIDE_HOURS",
    });
  });

  it("rejects bad input before touching the database", async () => {
    for (const bad of [
      { durationMinutes: 45 },
      { durationMinutes: 600 },
      { phone: "abc" },
      { name: "" },
      { start: "tomorrow" },
      { resourceType: "venue" },
    ]) {
      const result = await placeOnlineBooking(alice, input(bad) as never, NOW);
      expect(result.ok).toBe(false);
    }
    expect(await Booking.countDocuments()).toBe(0);
  });
});

describe("loadManagedBooking", () => {
  it("shows the booking to whoever holds the link", async () => {
    const { code, manageToken } = await aliceBooks();

    const booking = await loadManagedBooking(code, manageToken, null);

    expect(booking).toMatchObject({ access: "token", code, status: "confirmed", customerName: "Alice" });
    expect(booking?.stationNames).toEqual(["PC 01", "PC 02"]);
    expect(booking?.cancelUntil).toEqual(algiers("2026-12-02", "16:00"));
  });

  it("shows it to its customer when logged in, without the link", async () => {
    const { code } = await aliceBooks();
    expect((await loadManagedBooking(code, undefined, alice))?.access).toBe("owner");
  });

  it("shows it to staff", async () => {
    const { code } = await aliceBooks();
    expect((await loadManagedBooking(code, undefined, staff))?.access).toBe("staff");
  });

  it("hides it from everyone else, the same way as an unknown code", async () => {
    const { code, manageToken } = await aliceBooks();

    expect(await loadManagedBooking(code, undefined, null)).toBeNull();
    expect(await loadManagedBooking(code, "wrong-token", null)).toBeNull();
    expect(await loadManagedBooking(code, manageToken.slice(0, -1), bob)).toBeNull();
    expect(await loadManagedBooking(code, undefined, bob)).toBeNull();
    expect(await loadManagedBooking("GC-ZZZZ", manageToken, null)).toBeNull();
  });
});

describe("cancelManagedBooking", () => {
  it("cancels with the link and frees the stations", async () => {
    const { code, manageToken } = await aliceBooks();

    expect(await cancelManagedBooking(code, manageToken, null, NOW)).toEqual({ ok: true });

    expect((await Booking.findOne({ code }).lean())?.status).toBe("cancelled");
    expect(await SlotLock.countDocuments()).toBe(0);
    expect((await placeOnlineBooking(bob, input({ name: "Bob" }), NOW)).ok).toBe(true);
  });

  it("refuses without access, and leaves the booking alone", async () => {
    const { code } = await aliceBooks();

    expect(await cancelManagedBooking(code, "wrong-token", bob, NOW)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect((await Booking.findOne({ code }).lean())?.status).toBe("confirmed");
  });

  it("holds the customer to the 2-hour cutoff but lets staff cancel later", async () => {
    const { code, manageToken } = await aliceBooks();
    const late = algiers("2026-12-02", "16:30");

    expect(await cancelManagedBooking(code, manageToken, null, late)).toEqual({ ok: false, error: "CUTOFF_PASSED" });
    expect(await cancelManagedBooking(code, undefined, alice, late)).toEqual({ ok: false, error: "CUTOFF_PASSED" });
    expect(await cancelManagedBooking(code, undefined, staff, late)).toEqual({ ok: true });

    const history = (await Booking.findOne({ code }).lean())?.history ?? [];
    expect(history.at(-1)).toMatchObject({ to: "cancelled", by: `staff:${staff.id}` });
  });

  it("records the customer as the one who cancelled", async () => {
    const { code } = await aliceBooks();
    await cancelManagedBooking(code, undefined, alice, NOW);
    const history = (await Booking.findOne({ code }).lean())?.history ?? [];
    expect(history.at(-1)).toMatchObject({ to: "cancelled", by: `customer:${alice.id}` });
  });
});
