import { formatInTimeZone } from "date-fns-tz";
import { addMinutes, localDateOf } from "@/lib/booking";
import { completeEndedSessions, expireStaleRequests } from "./booking-service";
import { connectDb } from "./db";
import { notify, type NotifyResult } from "./email/notify";
import { Booking, type BookingRecord } from "./models/booking";
import { Settings } from "./models/settings";

/**
 * The cron tick: everything that has to happen without anyone pressing a
 * button. Safe to run as often as you like; every email is de-duplicated and
 * every status change checks the current status first.
 */

/** How long before the start the reminder goes out (spec, "Notifications"). */
export const REMINDER_MINUTES = { station: 120, venue: 24 * 60 } as const;
/** Local time from which the owner's daily summary is sent. */
export const SUMMARY_TIME = "09:00";

export interface TickReport {
  expired: number;
  completed: number;
  reminders: number;
  expiryEmails: number;
  summary: NotifyResult["status"] | "not_yet";
  errors: string[];
}

export async function runTick(now: Date = new Date()): Promise<TickReport> {
  await connectDb();
  const report: TickReport = { expired: 0, completed: 0, reminders: 0, expiryEmails: 0, summary: "not_yet", errors: [] };
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      console.error(`cron tick: ${name} failed:`, error);
      report.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
    }
  };

  await step("expire", async () => {
    report.expired = (await expireStaleRequests(now)).length;
  });

  // Requests can also expire during a page view; tell those customers too.
  await step("expiry emails", async () => {
    const recent = await Booking.find({
      type: "venue",
      status: "expired",
      // History carries the engine's clock; updatedAt is the database's.
      history: { $elemMatch: { to: "expired", at: { $gte: addMinutes(now, -48 * 60) } } },
    }).lean<BookingRecord[]>();
    for (const booking of recent) {
      if ((await notify({ type: "lan_expired", booking }, { now })).status === "sent") report.expiryEmails++;
    }
  });

  await step("complete", async () => {
    report.completed = (await completeEndedSessions(now)).length;
  });

  await step("reminders", async () => {
    for (const type of ["station", "venue"] as const) {
      const lead = REMINDER_MINUTES[type];
      const due = await Booking.find({
        type,
        status: "confirmed",
        start: { $gt: now, $lte: addMinutes(now, lead) },
        "customer.email": { $exists: true },
      }).lean<BookingRecord[]>();
      for (const booking of due) {
        // Booked inside the reminder window: the confirmation just went out.
        const bookedAt = booking.history[0]?.at ?? booking.createdAt;
        if (bookedAt > addMinutes(booking.start, -lead)) continue;
        if ((await notify({ type: "reminder", booking }, { now })).status === "sent") report.reminders++;
      }
    }
  });

  await step("summary", async () => {
    const settings = await Settings.findOne({ key: "default" }).select({ timezone: 1 }).lean();
    if (!settings) return;
    if (formatInTimeZone(now, settings.timezone, "HH:mm") < SUMMARY_TIME) return;
    report.summary = (await notify({ type: "daily_summary", date: localDateOf(now, settings.timezone) }, { now })).status;
  });

  return report;
}
