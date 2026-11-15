import { getAppUrl } from "@/lib/env";
import { connectDb } from "../db";
import type { BookingRecord } from "../models/booking";
import { EmailLog, type EmailTemplate } from "../models/email-log";
import { Resource } from "../models/resource";
import { Settings } from "../models/settings";
import { composeBookingConfirmed, composeLoginCode } from "./compose";
import { defaultTransport, type EmailMessage, type EmailTransport } from "./transport";

/**
 * The single place the app sends email from. Booking logic calls notify() and
 * never talks to a provider, so another channel (WhatsApp) can be added here
 * without touching it.
 *
 * notify() never throws. A booking must succeed even when its email does not;
 * the outcome is returned and written to `emailLog`.
 */

export const LOGIN_CODE_EXPIRES_MINUTES = 10;
/** Per address. See "Rate limits" in docs/SPEC.md. */
export const LOGIN_CODES_PER_HOUR = 5;

export type NotifyEvent =
  | { type: "login_code"; to: string; code: string }
  | { type: "booking_confirmed"; booking: BookingRecord; manageToken: string };

export type NotifyStatus = "sent" | "failed" | "skipped" | "rate_limited";

export interface NotifyResult {
  status: NotifyStatus;
  /** Why it was not sent. Safe to log; never contains a login code. */
  reason?: string;
}

export interface NotifyDeps {
  transport?: EmailTransport;
  now?: Date;
}

export async function notify(event: NotifyEvent, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const now = deps.now ?? new Date();
  try {
    await connectDb();
    await indexes();
    return event.type === "login_code"
      ? await sendLoginCode(event, now, deps.transport)
      : await sendBookingConfirmed(event, now, deps.transport);
  } catch (error) {
    console.error(`notify(${event.type}) failed before sending:`, describe(error));
    return { status: "failed", reason: describe(error) };
  }
}

async function sendLoginCode(
  event: Extract<NotifyEvent, { type: "login_code" }>,
  now: Date,
  transport?: EmailTransport,
): Promise<NotifyResult> {
  const to = event.to.trim().toLowerCase();

  const recent = await EmailLog.countDocuments({
    to,
    template: "login_code",
    requestedAt: { $gt: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  if (recent >= LOGIN_CODES_PER_HOUR) {
    return { status: "rate_limited", reason: "too many login codes for this address" };
  }

  const venue = await venueInfo();
  return deliver(
    { to, template: "login_code", requestedAt: now },
    () => composeLoginCode({ to, code: event.code, expiresMinutes: LOGIN_CODE_EXPIRES_MINUTES, venue }),
    transport,
  );
}

async function sendBookingConfirmed(
  event: Extract<NotifyEvent, { type: "booking_confirmed" }>,
  now: Date,
  transport?: EmailTransport,
): Promise<NotifyResult> {
  const { booking } = event;
  const to = booking.customer.email;
  if (!to) return { status: "skipped", reason: "the booking has no email address" };

  const [settings, stations] = await Promise.all([
    Settings.findOne({ key: "default" }).lean(),
    Resource.find({ _id: { $in: booking.resourceIds } })
      .select({ name: 1, sortOrder: 1 })
      .sort({ sortOrder: 1 })
      .lean(),
  ]);
  if (!settings) return { status: "failed", reason: "settings are missing" };

  return deliver(
    {
      to,
      template: "booking_confirmed",
      requestedAt: now,
      bookingId: booking._id,
      // One confirmation per booking, however many times this is called.
      dedupeKey: `booking_confirmed:${booking._id}`,
    },
    () =>
      composeBookingConfirmed({
        to,
        booking: {
          code: booking.code,
          start: booking.start,
          end: booking.end,
          priceEstimate: booking.priceEstimate,
          customerName: booking.customer.name,
        },
        stationNames: stations.map((s) => s.name),
        venue: {
          venueName: settings.venueName,
          address: settings.address ?? "",
          timezone: settings.timezone,
          currency: settings.currency,
        },
        graceMinutes: settings.graceMinutes,
        cancelCutoffMinutes: settings.station?.cancelCutoffMinutes ?? 0,
        manageUrl: `${getAppUrl()}/booking/${booking.code}?t=${encodeURIComponent(event.manageToken)}`,
        now,
      }),
    transport,
  );
}

/** Writes the log row, sends, and records the outcome. */
async function deliver(
  log: {
    to: string;
    template: EmailTemplate;
    requestedAt: Date;
    bookingId?: BookingRecord["_id"];
    dedupeKey?: string;
  },
  compose: () => Promise<EmailMessage>,
  transport: EmailTransport = defaultTransport(),
): Promise<NotifyResult> {
  let rowId;
  try {
    rowId = (await EmailLog.create({ ...log, status: "pending" }))._id;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return { status: "skipped", reason: "already sent" };
    }
    throw error;
  }

  try {
    const { providerId } = await transport(await compose());
    await EmailLog.updateOne(
      { _id: rowId },
      { $set: { status: "sent", sentAt: new Date(), ...(providerId ? { providerId } : {}) } },
    );
    return { status: "sent" };
  } catch (error) {
    const reason = describe(error);
    // Free the de-duplication key so a later retry can send this email.
    await EmailLog.updateOne(
      { _id: rowId },
      { $set: { status: "failed", error: reason }, $unset: { dedupeKey: "" } },
    );
    console.error(`notify(${log.template}) could not send to ${log.to}:`, reason);
    return { status: "failed", reason };
  }
}

async function venueInfo(): Promise<{ venueName: string; address: string }> {
  const settings = await Settings.findOne({ key: "default" }).select({ venueName: 1, address: 1 }).lean();
  // Login must work on a database that has not been seeded yet.
  return { venueName: settings?.venueName ?? "Respawn Cyber Gaming", address: settings?.address ?? "" };
}

let indexesReady: Promise<unknown> | undefined;
function indexes() {
  indexesReady ??= EmailLog.init().catch((error) => {
    indexesReady = undefined;
    throw error;
  });
  return indexesReady;
}

function describe(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, 300);
}
