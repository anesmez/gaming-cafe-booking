import { getAppUrl } from "@/lib/env";
import { connectDb } from "../db";
import type { BookingRecord } from "../models/booking";
import { EmailLog, type EmailTemplate } from "../models/email-log";
import { Resource } from "../models/resource";
import { Settings } from "../models/settings";
import { User } from "../models/user";
import { businessDayWindow, isLocalDate } from "@/lib/booking";
import { Booking } from "../models/booking";
import {
  composeBookingChanged,
  composeBookingConfirmed,
  composeDailySummary,
  composeLanEmail,
  composeLanExpired,
  composeLoginCode,
  composeReminder,
  type SimpleBooking,
  type VenueInfo,
} from "./compose";
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
  | { type: "booking_confirmed"; booking: BookingRecord; manageToken: string }
  /** Sent to the customer and to every owner account. */
  | { type: "lan_requested"; booking: BookingRecord; manageToken: string }
  | { type: "lan_decided"; booking: BookingRecord; decision: "approved" | "rejected"; note?: string }
  /** The request ran out of time without an answer. */
  | { type: "lan_expired"; booking: BookingRecord }
  /** Sent once, 2 hours before a station booking and 24 hours before a LAN. */
  | { type: "reminder"; booking: BookingRecord }
  /** To the customer; also to the team when the customer cancelled. */
  | { type: "booking_cancelled"; booking: BookingRecord; byCustomer: boolean }
  | { type: "booking_moved"; booking: BookingRecord; previous: { start: Date; end: Date } }
  /** To every owner account, once per business day. `date` is YYYY-MM-DD in the venue timezone. */
  | { type: "daily_summary"; date: string };

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
    switch (event.type) {
      case "login_code":
        return await sendLoginCode(event, now, deps.transport);
      case "booking_confirmed":
        return await sendBookingConfirmed(event, now, deps.transport);
      case "lan_requested":
        return await sendLanRequested(event, now, deps.transport);
      case "lan_decided":
        return await sendLanDecided(event, now, deps.transport);
      case "lan_expired":
        return await sendLanExpired(event, now, deps.transport);
      case "reminder":
        return await sendReminder(event, now, deps.transport);
      case "booking_cancelled":
        return await sendCancelled(event, now, deps.transport);
      case "booking_moved":
        return await sendMoved(event, now, deps.transport);
      case "daily_summary":
        return await sendDailySummary(event, now, deps.transport);
    }
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

async function lanContext(booking: BookingRecord) {
  const settings = await Settings.findOne({ key: "default" }).lean();
  if (!settings) return null;
  return {
    venue: {
      venueName: settings.venueName,
      address: settings.address ?? "",
      timezone: settings.timezone,
      currency: settings.currency,
    },
    approvalTimeoutHours: settings.venue?.approvalTimeoutHours ?? 24,
    booking: {
      code: booking.code,
      start: booking.start,
      end: booking.end,
      customerName: booking.customer.name,
      customerPhone: booking.customer.phone,
      ...(booking.partySize ? { partySize: booking.partySize } : {}),
      ...(booking.notes ? { notes: booking.notes } : {}),
      ...(booking.quotedPrice ? { quotedPrice: booking.quotedPrice } : {}),
    },
  };
}

/** Customer: "request received". Every owner: "new request", with a link to answer. */
async function sendLanRequested(
  event: Extract<NotifyEvent, { type: "lan_requested" }>,
  now: Date,
  transport?: EmailTransport,
): Promise<NotifyResult> {
  const { booking } = event;
  const ctx = await lanContext(booking);
  if (!ctx) return { status: "failed", reason: "settings are missing" };

  const results: NotifyResult[] = [];
  if (booking.customer.email) {
    const to = booking.customer.email;
    results.push(
      await deliver(
        { to, template: "lan_requested", requestedAt: now, bookingId: booking._id, dedupeKey: `lan_requested:${booking._id}` },
        () =>
          composeLanEmail("requested", {
            ...ctx,
            to,
            url: `${getAppUrl()}/booking/${booking.code}?t=${encodeURIComponent(event.manageToken)}`,
          }),
        transport,
      ),
    );
  }

  const owners = await User.find({ role: "owner" }).select({ email: 1 }).lean();
  const firstAt = booking.history[0]?.at ?? now;
  for (const owner of owners) {
    results.push(
      await deliver(
        {
          to: owner.email,
          template: "lan_request_owner",
          requestedAt: now,
          bookingId: booking._id,
          dedupeKey: `lan_request_owner:${booking._id}:${owner.email}`,
        },
        () =>
          composeLanEmail("owner", {
            ...ctx,
            to: owner.email,
            url: `${getAppUrl()}/admin/requests`,
            deadline: new Date(firstAt.getTime() + ctx.approvalTimeoutHours * 3_600_000),
          }),
        transport,
      ),
    );
  }

  return summarise(results);
}

async function sendLanDecided(
  event: Extract<NotifyEvent, { type: "lan_decided" }>,
  now: Date,
  transport?: EmailTransport,
): Promise<NotifyResult> {
  const { booking, decision } = event;
  const to = booking.customer.email;
  if (!to) return { status: "skipped", reason: "the booking has no email address" };
  const ctx = await lanContext(booking);
  if (!ctx) return { status: "failed", reason: "settings are missing" };

  const template = decision === "approved" ? "lan_approved" : "lan_rejected";
  return deliver(
    { to, template, requestedAt: now, bookingId: booking._id, dedupeKey: `${template}:${booking._id}` },
    () =>
      composeLanEmail(decision, {
        ...ctx,
        to,
        // The customer opens it logged in; the decision email carries no token.
        url: `${getAppUrl()}/booking/${booking.code}`,
        ...(event.note ? { ownerNote: event.note } : {}),
      }),
    transport,
  );
}

async function venueContext(): Promise<{ venue: VenueInfo; graceMinutes: number; openingHours: { weekday: number; open: string; close: string }[] } | null> {
  const settings = await Settings.findOne({ key: "default" }).lean();
  if (!settings) return null;
  return {
    venue: { venueName: settings.venueName, address: settings.address ?? "", timezone: settings.timezone, currency: settings.currency },
    graceMinutes: settings.graceMinutes,
    openingHours: settings.openingHours.map((h) => ({ weekday: h.weekday, open: h.open, close: h.close })),
  };
}

function simple(booking: BookingRecord): SimpleBooking {
  return { code: booking.code, type: booking.type, start: booking.start, end: booking.end, customerName: booking.customer.name };
}

async function stationNames(ids: BookingRecord["resourceIds"]): Promise<string[]> {
  const rows = await Resource.find({ _id: { $in: ids } }).select({ name: 1, sortOrder: 1 }).sort({ sortOrder: 1 }).lean();
  return rows.map((r) => r.name);
}

async function sendLanExpired(event: Extract<NotifyEvent, { type: "lan_expired" }>, now: Date, transport?: EmailTransport): Promise<NotifyResult> {
  const { booking } = event;
  const to = booking.customer.email;
  if (!to) return { status: "skipped", reason: "the booking has no email address" };
  const ctx = await venueContext();
  if (!ctx) return { status: "failed", reason: "settings are missing" };
  return deliver(
    { to, template: "lan_expired", requestedAt: now, bookingId: booking._id, dedupeKey: `lan_expired:${booking._id}` },
    () => composeLanExpired({ to, booking: simple(booking), venue: ctx.venue, url: `${getAppUrl()}/book/lan` }),
    transport,
  );
}

async function sendReminder(event: Extract<NotifyEvent, { type: "reminder" }>, now: Date, transport?: EmailTransport): Promise<NotifyResult> {
  const { booking } = event;
  const to = booking.customer.email;
  if (!to) return { status: "skipped", reason: "the booking has no email address" };
  const [ctx, names] = await Promise.all([venueContext(), stationNames(booking.resourceIds)]);
  if (!ctx) return { status: "failed", reason: "settings are missing" };
  return deliver(
    { to, template: "reminder", requestedAt: now, bookingId: booking._id, dedupeKey: `reminder:${booking._id}` },
    () =>
      composeReminder({
        to,
        booking: simple(booking),
        stationNames: names,
        venue: ctx.venue,
        graceMinutes: ctx.graceMinutes,
        url: `${getAppUrl()}/booking/${booking.code}`,
      }),
    transport,
  );
}

async function sendCancelled(event: Extract<NotifyEvent, { type: "booking_cancelled" }>, now: Date, transport?: EmailTransport): Promise<NotifyResult> {
  const { booking, byCustomer } = event;
  const [ctx, names] = await Promise.all([venueContext(), stationNames(booking.resourceIds)]);
  if (!ctx) return { status: "failed", reason: "settings are missing" };
  const results: NotifyResult[] = [];
  const to = booking.customer.email;
  if (to) {
    results.push(
      await deliver(
        { to, template: "booking_cancelled", requestedAt: now, bookingId: booking._id, dedupeKey: `booking_cancelled:${booking._id}` },
        () =>
          composeBookingChanged("cancelled", {
            to,
            booking: simple(booking),
            stationNames: names,
            venue: ctx.venue,
            url: `${getAppUrl()}/book`,
            byCustomer,
          }),
        transport,
      ),
    );
  }
  if (byCustomer) {
    const team = await User.find({ role: { $in: ["owner", "staff"] } }).select({ email: 1 }).lean();
    for (const member of team) {
      results.push(
        await deliver(
          {
            to: member.email,
            template: "team_cancellation",
            requestedAt: now,
            bookingId: booking._id,
            dedupeKey: `team_cancellation:${booking._id}:${member.email}`,
          },
          () =>
            composeBookingChanged("team", {
              to: member.email,
              booking: simple(booking),
              stationNames: names,
              venue: ctx.venue,
              url: `${getAppUrl()}/admin/bookings/${booking.code}`,
            }),
          transport,
        ),
      );
    }
  }
  return summarise(results);
}

async function sendMoved(event: Extract<NotifyEvent, { type: "booking_moved" }>, now: Date, transport?: EmailTransport): Promise<NotifyResult> {
  const { booking, previous } = event;
  const to = booking.customer.email;
  if (!to) return { status: "skipped", reason: "the booking has no email address" };
  const [ctx, names] = await Promise.all([venueContext(), stationNames(booking.resourceIds)]);
  if (!ctx) return { status: "failed", reason: "settings are missing" };
  return deliver(
    {
      to,
      template: "booking_moved",
      requestedAt: now,
      bookingId: booking._id,
      // One email per move.
      dedupeKey: `booking_moved:${booking._id}:${booking.history.length}`,
    },
    () =>
      composeBookingChanged("moved", {
        to,
        booking: simple(booking),
        stationNames: names,
        venue: ctx.venue,
        url: `${getAppUrl()}/booking/${booking.code}`,
        previous,
      }),
    transport,
  );
}

async function sendDailySummary(event: Extract<NotifyEvent, { type: "daily_summary" }>, now: Date, transport?: EmailTransport): Promise<NotifyResult> {
  if (!isLocalDate(event.date)) return { status: "failed", reason: "date must be YYYY-MM-DD" };
  const ctx = await venueContext();
  if (!ctx) return { status: "failed", reason: "settings are missing" };
  const day = businessDayWindow(event.date, ctx.openingHours, ctx.venue.timezone);

  const [bookings, pendingRequests, owners] = await Promise.all([
    day
      ? Booking.find({
          type: { $in: ["station", "venue"] },
          status: { $in: ["confirmed", "checked_in", "pending_approval"] },
          start: { $gte: day.open, $lt: day.close },
        })
          .sort({ start: 1 })
          .lean<BookingRecord[]>()
      : Promise.resolve([] as BookingRecord[]),
    Booking.countDocuments({ type: "venue", status: "pending_approval" }),
    User.find({ role: "owner" }).select({ email: 1 }).lean(),
  ]);
  const names = new Map(
    (await Resource.find({ _id: { $in: bookings.flatMap((b) => b.resourceIds) } }).select({ name: 1, sortOrder: 1 }).lean()).map(
      (r) => [String(r._id), { name: r.name, order: r.sortOrder }],
    ),
  );
  const rows = bookings.map((b) => ({
    ...simple(b),
    stationNames: b.resourceIds
      .map((id) => names.get(String(id)))
      .filter((r): r is { name: string; order: number } => Boolean(r))
      .sort((a, z) => a.order - z.order)
      .map((r) => r.name),
  }));

  const results: NotifyResult[] = [];
  for (const owner of owners) {
    results.push(
      await deliver(
        { to: owner.email, template: "daily_summary", requestedAt: now, dedupeKey: `daily_summary:${event.date}:${owner.email}` },
        () =>
          composeDailySummary({
            to: owner.email,
            date: day?.open ?? new Date(`${event.date}T12:00:00Z`),
            open: Boolean(day),
            venue: ctx.venue,
            bookings: rows,
            pendingRequests,
            url: `${getAppUrl()}/admin`,
          }),
        transport,
      ),
    );
  }
  return summarise(results);
}

/** Worst outcome of several sends wins; all skipped counts as skipped. */
function summarise(results: NotifyResult[]): NotifyResult {
  if (results.length === 0) return { status: "skipped", reason: "nobody to notify" };
  return results.find((r) => r.status === "failed") ?? results.find((r) => r.status === "sent") ?? results[0];
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
