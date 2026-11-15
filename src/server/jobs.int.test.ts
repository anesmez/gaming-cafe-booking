import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { algiers, testSettings } from "@/lib/booking/fixtures";
import { checkInBooking, createBooking, requestVenueBooking } from "./booking-service";
import { connectDb, disconnectDb } from "./db";
import { runTick } from "./jobs";
import { Booking } from "./models/booking";
import { EmailLog, type EmailTemplate } from "./models/email-log";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { seed } from "./seed";

/** Milestone 8: the cron tick. Test hours: open 10:00 to 02:00. */

const DAY = "2026-12-04";
const at = (time: string, date = DAY) => algiers(date, time);
const staff = { role: "staff" as const };
const customer = { name: "Yanis", phone: "0551 22 33 44", email: "yanis@example.com" };

let replSet: MongoMemoryReplSet;
let pcIds: string[];

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-jobs-test"));
  await seed("owner@example.com");
  await Settings.updateOne({ key: "default" }, { $set: { openingHours: testSettings().openingHours } });
  pcIds = (await Resource.find({ type: "pc" }).sort({ sortOrder: 1 }).lean()).map((r) => String(r._id));
}, 120_000);

afterEach(async () => {
  await Promise.all([Booking.deleteMany({}), SlotLock.deleteMany({}), EmailLog.deleteMany({})]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await disconnectDb();
  await replSet?.stop();
});

function book(resourceId: string, start: Date, end: Date, now: Date) {
  return createBooking(
    { actor: staff, start, end, stations: { mode: "explicit", resourceIds: [resourceId] }, customer, source: "phone" },
    { now },
  );
}

const sent = (template: EmailTemplate) => EmailLog.countDocuments({ template, status: "sent" });

describe("cron tick", () => {
  it("sends one reminder two hours before, and none for a last-minute booking", async () => {
    await book(pcIds[0], at("18:00"), at("20:00"), at("10:00"));
    await book(pcIds[1], at("18:30"), at("20:00"), at("17:00")); // booked inside the window

    expect((await runTick(at("15:30"))).reminders).toBe(0);
    expect((await runTick(at("16:00"))).reminders).toBe(1);
    expect((await runTick(at("16:30"))).reminders).toBe(0);
    expect(await sent("reminder")).toBe(1);
  });

  it("reminds a LAN a day ahead", async () => {
    const { booking } = await requestVenueBooking(
      { actor: { role: "customer" }, start: at("18:00"), end: at("23:00"), customer, partySize: 10 },
      { now: at("12:00", "2026-12-01") },
    );
    await Booking.updateOne({ _id: booking._id }, { $set: { status: "confirmed" } });
    await runTick(at("17:00", "2026-12-03"));
    expect(await sent("reminder")).toBe(0);
    await runTick(at("18:00", "2026-12-03"));
    expect(await sent("reminder")).toBe(1);
  });

  it("completes a session once its end has passed and frees what is left", async () => {
    const { booking } = await book(pcIds[2], at("18:00"), at("20:00"), at("10:00"));
    await checkInBooking({ code: booking.code, actor: staff }, { now: at("18:00") });
    expect((await runTick(at("19:59"))).completed).toBe(0);
    expect((await runTick(at("20:00"))).completed).toBe(1);
    expect(await Booking.findById(booking._id).lean()).toMatchObject({ status: "completed" });
    expect(await SlotLock.countDocuments({ bookingId: booking._id })).toBe(0);
  });

  it("expires an unanswered request and tells the group, once", async () => {
    const requested = at("12:00", "2026-12-01");
    await requestVenueBooking(
      { actor: { role: "customer" }, start: at("18:00"), end: at("22:00"), customer, partySize: 8 },
      { now: requested },
    );
    const later = at("12:30", "2026-12-02");
    const report = await runTick(later);
    expect(report).toMatchObject({ expired: 1, expiryEmails: 1, errors: [] });
    expect(await SlotLock.countDocuments()).toBe(0);
    expect((await runTick(later)).expiryEmails).toBe(0);
  });

  it("sends the owner's summary once a day, from 09:00", async () => {
    await book(pcIds[0], at("18:00"), at("20:00"), at("08:00"));
    expect((await runTick(at("08:30"))).summary).toBe("not_yet");
    expect((await runTick(at("09:00"))).summary).toBe("sent");
    expect((await runTick(at("15:00"))).summary).toBe("skipped");
    expect(await EmailLog.find({ template: "daily_summary" }).lean()).toEqual([
      expect.objectContaining({ to: "owner@example.com", status: "sent" }),
    ]);
  });
});
