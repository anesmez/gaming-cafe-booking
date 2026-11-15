import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  BookingError,
  addMinutes,
  LOCK_HOLDING_STATUSES,
  assertCancellable,
  assertCustomerMayBook,
  businessDayWindow,
  estimatePrice,
  expandSlots,
  generateBookingCode,
  isLocalDate,
  normalizeBookingCode,
  pickStations,
  validateStationBooking,
  validateVenueRequest,
  type ActorKind,
  type BookingSettings,
} from "@/lib/booking";
import { connectDb } from "./db";
import { Booking, type BookingRecord } from "./models/booking";
import { RESOURCE_TYPES, Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { USER_ROLES, User } from "./models/user";

/**
 * The booking engine. This module is the only code that writes the `bookings`
 * and `slotLocks` collections (see CLAUDE.md).
 *
 * Double bookings are prevented by the unique index on
 * slotLocks (resourceId, slotStart). Every write that takes slots inserts its
 * locks in the same transaction as the booking change; a duplicate key aborts
 * the whole transaction and surfaces as SLOT_TAKEN. There is no check-then-
 * insert and no override path.
 */

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "must be a 24-character id");

const actorSchema = z.object({
  role: z.enum(USER_ROLES),
  userId: objectId.optional(),
});
export type Actor = z.infer<typeof actorSchema>;

const customerSchema = z.object({
  userId: objectId.optional(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(20),
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
});

const stationsSchema = z.discriminatedUnion("mode", [
  // The system assigns adjacent free stations. The only mode customers can use.
  z.object({
    mode: z.literal("auto"),
    resourceType: z.enum(RESOURCE_TYPES),
    count: z.number().int().min(1).max(100).default(1),
  }),
  // Staff name the stations.
  z.object({
    mode: z.literal("explicit"),
    resourceIds: z.array(objectId).min(1).max(100),
  }),
]);

const createBookingSchema = z.object({
  actor: actorSchema,
  stations: stationsSchema,
  start: z.date(),
  end: z.date(),
  customer: customerSchema,
  partySize: z.number().int().min(1).max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  source: z.enum(BOOKING_SOURCES).default("online"),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

const cancelBookingSchema = z.object({
  code: z.string().min(1).max(20),
  actor: actorSchema,
  note: z.string().trim().max(500).optional(),
});
export type CancelBookingInput = z.input<typeof cancelBookingSchema>;

const moveBookingSchema = z.object({
  code: z.string().min(1).max(20),
  actor: actorSchema,
  start: z.date(),
  end: z.date(),
  /** Omit to keep the current stations. */
  resourceIds: z.array(objectId).min(1).max(100).optional(),
  note: z.string().trim().max(500).optional(),
});
export type MoveBookingInput = z.input<typeof moveBookingSchema>;

const availabilitySchema = z.object({
  date: z.string(),
  resourceType: z.enum(RESOURCE_TYPES).optional(),
  /** True for the public site: hides stations kept for walk-ins. */
  onlineOnly: z.boolean().default(false),
});
export type AvailabilityInput = z.input<typeof availabilitySchema>;

export interface Clock {
  /** Injected in tests. Defaults to the current time. */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CreatedBooking {
  booking: BookingRecord;
  /** Raw token for the customer's manage link. Shown once; only its hash is stored. */
  manageToken: string;
}

export interface ResourceAvailability {
  id: string;
  name: string;
  type: (typeof RESOURCE_TYPES)[number];
  sortOrder: number;
  bookableOnline: boolean;
  hourlyRate: number;
  /** One entry per slot in `slotStarts`: true when no booking holds it. */
  free: boolean[];
}

export interface Availability {
  date: string;
  timezone: string;
  slotMinutes: number;
  /** False when the venue has no opening hours that day. */
  open: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  slotStarts: Date[];
  resources: ResourceAvailability[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createBooking(raw: CreateBookingInput, clock: Clock = {}): Promise<CreatedBooking> {
  const input = parse(createBookingSchema, raw);
  const now = clock.now ?? new Date();
  const actorKind = kindOf(input.actor);

  if (actorKind === "customer") {
    if (input.stations.mode !== "auto") {
      throw new BookingError("FORBIDDEN", "customers cannot choose specific stations");
    }
    if (!input.customer.email) {
      throw new BookingError("INVALID_INPUT", "customer.email is required for online bookings");
    }
  }

  await ready();
  const settings = await loadSettings();

  const stations = input.stations;
  const explicitIds = stations.mode === "explicit" ? [...new Set(stations.resourceIds)] : null;
  const stationCount = stations.mode === "explicit" ? new Set(stations.resourceIds).size : stations.count;

  validateStationBooking(
    { start: input.start, end: input.end, stationCount, actor: actorKind },
    settings,
    now,
  );

  if (actorKind === "customer") {
    assertCustomerMayBook(await customerStanding(input.customer, now), settings);
  }
  // A request nobody answered must not block this booking.
  await expireStaleRequests(now);

  const draft: BookingDraft = {
    start: input.start,
    end: input.end,
    customer: {
      ...(input.customer.userId ? { userId: new Types.ObjectId(input.customer.userId) } : {}),
      name: input.customer.name,
      phone: input.customer.phone,
      ...(input.customer.email ? { email: input.customer.email } : {}),
    },
    ...(input.partySize ? { partySize: input.partySize } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    source: actorKind === "customer" ? "online" : input.source,
    by: actorLabel(input.actor),
    now,
  };

  if (stations.mode === "explicit" && explicitIds) {
    const chosen = await Resource.find({ _id: { $in: explicitIds }, active: true })
      .select({ hourlyRate: 1 })
      .lean();
    if (chosen.length !== explicitIds.length) {
      throw new BookingError("NOT_FOUND", "one or more stations do not exist or are inactive");
    }
    return insertBooking(draft, chosen, settings);
  }
  if (stations.mode !== "auto") throw new BookingError("INVALID_INPUT", "unknown station mode");

  // Auto-assign. Another request can take a picked station between our read and
  // our insert; each such loss means one more station is gone, so the loop ends
  // after at most pool.length rounds.
  const pool = await Resource.find({
    type: stations.resourceType,
    active: true,
    ...(actorKind === "customer" ? { bookableOnline: true } : {}),
  })
    .select({ sortOrder: 1, hourlyRate: 1 })
    .sort({ sortOrder: 1 })
    .lean();

  for (let round = 0; round <= pool.length; round++) {
    const taken = new Set(
      (
        await SlotLock.distinct("resourceId", {
          resourceId: { $in: pool.map((r) => r._id) },
          slotStart: { $gte: input.start, $lt: input.end },
        })
      ).map(String),
    );

    const picked = pickStations(
      pool.map((r) => ({ id: String(r._id), sortOrder: r.sortOrder, free: !taken.has(String(r._id)) })),
      stationCount,
    );
    if (!picked) break;

    try {
      return await insertBooking(
        draft,
        pool.filter((r) => picked.includes(String(r._id))),
        settings,
      );
    } catch (error) {
      if (error instanceof BookingError && error.code === "SLOT_TAKEN") continue;
      throw error;
    }
  }

  throw new BookingError("SLOT_TAKEN");
}

export async function cancelBooking(raw: CancelBookingInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(cancelBookingSchema, raw);
  const now = clock.now ?? new Date();

  await ready();
  const settings = await loadSettings();
  const booking = await findByCode(input.code);

  assertCancellable(booking, kindOf(input.actor), settings, now);

  await transaction(async (session) => {
    const update = await Booking.updateOne(
      { _id: booking._id, status: booking.status },
      {
        $set: { status: "cancelled" },
        $push: {
          history: {
            at: now,
            by: actorLabel(input.actor),
            from: booking.status,
            to: "cancelled",
            ...(input.note ? { note: input.note } : {}),
          },
        },
      },
      { session },
    );
    if (update.modifiedCount !== 1) {
      throw new BookingError("INVALID_STATE", "the booking changed while it was being cancelled");
    }
    // Locks exist only for bookings that hold slots, so all of them go, in the
    // same transaction as the status change.
    await SlotLock.deleteMany({ bookingId: booking._id }, { session });
  });

  return findByCode(input.code);
}

/**
 * Staff only. Moves a booking to another time and/or other stations. The old
 * locks are released and the new ones taken in one transaction, so a conflict
 * leaves the booking exactly where it was.
 */
export async function moveBooking(raw: MoveBookingInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(moveBookingSchema, raw);
  const now = clock.now ?? new Date();

  if (kindOf(input.actor) !== "staff") {
    throw new BookingError("FORBIDDEN", "only staff can move a booking");
  }

  await ready();
  const settings = await loadSettings();
  const booking = await findByCode(input.code);

  if (booking.type !== "station") {
    throw new BookingError("INVALID_STATE", "only station bookings can be moved");
  }
  if (booking.status !== "confirmed" && booking.status !== "checked_in") {
    throw new BookingError("INVALID_STATE", `a ${booking.status} booking cannot be moved`);
  }

  const resourceIds = input.resourceIds
    ? [...new Set(input.resourceIds)]
    : booking.resourceIds.map(String);
  const stations = await Resource.find({
    _id: { $in: resourceIds },
    // Stations the booking already holds may stay even if deactivated since.
    ...(input.resourceIds ? { active: true } : {}),
  })
    .select({ hourlyRate: 1 })
    .lean();
  if (stations.length !== resourceIds.length) {
    throw new BookingError("NOT_FOUND", "one or more stations do not exist or are inactive");
  }

  // Changing only the station of a session that already started (a broken PC)
  // must not fail the "no past slots" rule, so keep the original start as the clock.
  const sameStart = input.start.getTime() === booking.start.getTime();
  validateStationBooking(
    { start: input.start, end: input.end, stationCount: stations.length, actor: "staff" },
    settings,
    sameStart ? booking.start : now,
  );

  const slots = expandSlots(input.start, input.end, settings.slotMinutes);
  const moveNote = `moved from ${booking.start.toISOString()} – ${booking.end.toISOString()}`;

  await transaction(async (session) => {
    const update = await Booking.updateOne(
      { _id: booking._id, status: booking.status, start: booking.start, end: booking.end },
      {
        $set: {
          start: input.start,
          end: input.end,
          resourceIds: stations.map((s) => s._id),
          priceEstimate: estimatePrice(
            stations.map((s) => s.hourlyRate),
            input.start,
            input.end,
          ),
        },
        $push: {
          history: {
            at: now,
            by: actorLabel(input.actor),
            from: booking.status,
            to: booking.status,
            note: input.note ? `${moveNote}. ${input.note}` : moveNote,
          },
        },
      },
      { session },
    );
    if (update.modifiedCount !== 1) {
      throw new BookingError("INVALID_STATE", "the booking changed while it was being moved");
    }

    await SlotLock.deleteMany({ bookingId: booking._id }, { session });
    await insertLocks(
      stations.map((s) => s._id),
      slots,
      booking._id,
      session,
    );
  });

  return findByCode(input.code);
}

/** Free and taken slots for one business day, read from slot locks only. */
export async function getAvailability(raw: AvailabilityInput, clock: Clock = {}): Promise<Availability> {
  const input = parse(availabilitySchema, raw);
  if (!isLocalDate(input.date)) {
    throw new BookingError("INVALID_INPUT", "date must be YYYY-MM-DD");
  }

  await ready();
  await expireStaleRequests(clock.now ?? new Date());
  const settings = await loadSettings();
  const day = businessDayWindow(input.date, settings.openingHours, settings.timezone);

  const base = { date: input.date, timezone: settings.timezone, slotMinutes: settings.slotMinutes };
  if (!day) {
    return { ...base, open: false, opensAt: null, closesAt: null, slotStarts: [], resources: [] };
  }

  const resources = await Resource.find({
    active: true,
    ...(input.resourceType ? { type: input.resourceType } : {}),
    ...(input.onlineOnly ? { bookableOnline: true } : {}),
  })
    .sort({ sortOrder: 1 })
    .lean();

  const locks = await SlotLock.find({
    resourceId: { $in: resources.map((r) => r._id) },
    slotStart: { $gte: day.open, $lt: day.close },
  })
    .select({ resourceId: 1, slotStart: 1, _id: 0 })
    .lean();
  const taken = new Set(locks.map((l) => `${l.resourceId}:${l.slotStart.getTime()}`));

  const slotStarts = expandSlots(day.open, day.close, settings.slotMinutes);
  return {
    ...base,
    open: true,
    opensAt: day.open,
    closesAt: day.close,
    slotStarts,
    resources: resources.map((r) => ({
      id: String(r._id),
      name: r.name,
      type: r.type,
      sortOrder: r.sortOrder,
      bookableOnline: r.bookableOnline,
      hourlyRate: r.hourlyRate,
      free: slotStarts.map((slot) => !taken.has(`${r._id}:${slot.getTime()}`)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Counter actions (staff only)
// ---------------------------------------------------------------------------

const staffActionSchema = z.object({
  code: z.string().min(1).max(20),
  actor: actorSchema,
  note: z.string().trim().max(500).optional(),
});
export type StaffActionInput = z.input<typeof staffActionSchema>;

/** How early before its start a booking can be checked in. */
export const CHECK_IN_EARLY_MINUTES = 60;

/** The customer has arrived: confirmed → checked_in. Slots stay held. */
export async function checkInBooking(raw: StaffActionInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(staffActionSchema, raw);
  const now = clock.now ?? new Date();
  requireStaff(input.actor);
  await ready();

  const booking = await findByCode(input.code);
  if (booking.status !== "confirmed") {
    throw new BookingError("INVALID_STATE", `a ${booking.status} booking cannot be checked in`);
  }
  if (now < addMinutes(booking.start, -CHECK_IN_EARLY_MINUTES)) {
    throw new BookingError("TOO_SOON", "too early to check in");
  }
  if (now >= booking.end) throw new BookingError("INVALID_STATE", "the booking has already ended");

  await setStatus(booking, "checked_in", input, now, { releaseLocks: false });
  return findByCode(input.code);
}

/**
 * The customer did not come: confirmed → no_show, after the grace period.
 * Frees the slots and counts toward the customer's online booking block.
 */
export async function markNoShow(raw: StaffActionInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(staffActionSchema, raw);
  const now = clock.now ?? new Date();
  requireStaff(input.actor);
  await ready();
  const settings = await loadSettings();

  const booking = await findByCode(input.code);
  if (booking.status !== "confirmed") {
    throw new BookingError("INVALID_STATE", `a ${booking.status} booking cannot be marked as no-show`);
  }
  if (now < addMinutes(booking.start, settings.graceMinutes)) {
    throw new BookingError("TOO_SOON", "the grace period has not passed");
  }

  await setStatus(booking, "no_show", input, now, {
    releaseLocks: true,
    // Counted in the same transaction, so a retried no-show never counts twice.
    async extra(session) {
      const filter = booking.customer.userId
        ? { _id: booking.customer.userId }
        : booking.customer.email
          ? { email: booking.customer.email }
          : null;
      if (filter) await User.updateOne(filter, { $inc: { noShowCount: 1 } }, { session });
    },
  });
  return findByCode(input.code);
}

/** The session is over, possibly early: checked_in → completed. Frees what is left. */
export async function completeBooking(raw: StaffActionInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(staffActionSchema, raw);
  const now = clock.now ?? new Date();
  requireStaff(input.actor);
  await ready();

  const booking = await findByCode(input.code);
  if (booking.status !== "checked_in") {
    throw new BookingError("INVALID_STATE", `a ${booking.status} booking cannot be completed`);
  }
  await setStatus(booking, "completed", input, now, { releaseLocks: true });
  return findByCode(input.code);
}

async function setStatus(
  booking: BookingRecord,
  to: BookingRecord["status"],
  input: { actor: Actor | "system"; note?: string },
  now: Date,
  options: {
    releaseLocks: boolean;
    set?: Partial<Pick<BookingRecord, "quotedPrice">>;
    extra?: (session: mongoose.ClientSession) => Promise<void>;
  },
): Promise<void> {
  await transaction(async (session) => {
    const update = await Booking.updateOne(
      { _id: booking._id, status: booking.status },
      {
        $set: { status: to, ...options.set },
        $push: {
          history: {
            at: now,
            by: input.actor === "system" ? "system" : actorLabel(input.actor),
            from: booking.status,
            to,
            ...(input.note ? { note: input.note } : {}),
          },
        },
      },
      { session },
    );
    if (update.modifiedCount !== 1) {
      throw new BookingError("INVALID_STATE", "the booking changed in the meantime");
    }
    if (options.releaseLocks) await SlotLock.deleteMany({ bookingId: booking._id }, { session });
    await options.extra?.(session);
  });
}

function requireStaff(actor: Actor): void {
  if (kindOf(actor) !== "staff") throw new BookingError("FORBIDDEN", "staff only");
}

// ---------------------------------------------------------------------------
// Full-venue (LAN) requests
// ---------------------------------------------------------------------------

const venueRequestSchema = z.object({
  actor: actorSchema,
  start: z.date(),
  end: z.date(),
  customer: customerSchema,
  partySize: z.number().int().min(2).max(100),
  notes: z.string().trim().max(500).optional(),
});
export type VenueRequestInput = z.input<typeof venueRequestSchema>;

/**
 * A group asks for the whole venue. Every active station and the console are
 * locked from the start until after the cleanup buffer, in one transaction,
 * so the request only goes in when all of them are free. It waits for the
 * owner as pending_approval, holding those slots.
 */
export async function requestVenueBooking(raw: VenueRequestInput, clock: Clock = {}): Promise<CreatedBooking> {
  const input = parse(venueRequestSchema, raw);
  const now = clock.now ?? new Date();
  const actorKind = kindOf(input.actor);
  if (actorKind === "customer" && !input.customer.email) {
    throw new BookingError("INVALID_INPUT", "customer.email is required for online requests");
  }

  await ready();
  const settings = await loadSettings();
  const lockUntil = validateVenueRequest({ start: input.start, end: input.end }, settings, now);
  await expireStaleRequests(now);

  if (actorKind === "customer") {
    assertCustomerMayBook(await customerStanding(input.customer, now), settings);
  }

  const resources = await Resource.find({ active: true }).select({ hourlyRate: 1 }).sort({ sortOrder: 1 }).lean();
  if (resources.length === 0) throw new BookingError("NOT_FOUND", "no active stations");

  return insertBooking(
    {
      type: "venue",
      status: "pending_approval",
      start: input.start,
      end: input.end,
      lockUntil,
      customer: {
        ...(input.customer.userId ? { userId: new Types.ObjectId(input.customer.userId) } : {}),
        name: input.customer.name,
        phone: input.customer.phone,
        ...(input.customer.email ? { email: input.customer.email } : {}),
      },
      partySize: input.partySize,
      ...(input.notes ? { notes: input.notes } : {}),
      source: actorKind === "customer" ? "online" : "phone",
      by: actorLabel(input.actor),
      now,
    },
    resources,
    settings,
  );
}

const decisionSchema = z.object({
  code: z.string().min(1).max(20),
  actor: actorSchema,
  quotedPrice: z.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(500).optional(),
});
export type DecisionInput = z.input<typeof decisionSchema>;

async function pendingRequest(code: string, actor: Actor, now: Date): Promise<BookingRecord> {
  if (actor.role !== "owner") throw new BookingError("FORBIDDEN", "only the owner decides on LAN requests");
  await ready();
  await expireStaleRequests(now);
  const booking = await findByCode(code);
  if (booking.type !== "venue" || booking.status !== "pending_approval") {
    throw new BookingError("INVALID_STATE", `a ${booking.status} booking cannot be decided`);
  }
  return booking;
}

/** Owner says yes: pending → confirmed, with the agreed price. The slots stay held. */
export async function approveVenueBooking(raw: DecisionInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(decisionSchema, raw);
  const now = clock.now ?? new Date();
  const booking = await pendingRequest(input.code, input.actor, now);
  await setStatus(booking, "confirmed", input, now, {
    releaseLocks: false,
    ...(input.quotedPrice !== undefined ? { set: { quotedPrice: input.quotedPrice } } : {}),
  });
  return findByCode(input.code);
}

/** Owner says no: pending → rejected. Every slot is freed. */
export async function rejectVenueBooking(raw: DecisionInput, clock: Clock = {}): Promise<BookingRecord> {
  const input = parse(decisionSchema, raw);
  const now = clock.now ?? new Date();
  const booking = await pendingRequest(input.code, input.actor, now);
  await setStatus(booking, "rejected", input, now, { releaseLocks: true });
  return findByCode(input.code);
}

/**
 * Requests the owner has not answered within `approvalTimeoutHours` expire
 * and free their slots. Called before every read and write that depends on
 * availability, so an expired request never blocks anyone, and by the
 * scheduled job (milestone 8). Returns the expired bookings.
 */
export async function expireStaleRequests(now: Date = new Date()): Promise<BookingRecord[]> {
  const settings = await loadSettings();
  const cutoff = addMinutes(now, -settings.venue.approvalTimeoutHours * 60);
  // history[0].at is when the request was made, on the engine's clock.
  const stale = await Booking.find({ status: "pending_approval", "history.0.at": { $lte: cutoff } }).lean<
    BookingRecord[]
  >();

  const expired: BookingRecord[] = [];
  for (const booking of stale) {
    try {
      await setStatus(booking, "expired", { actor: "system", note: "no answer in time" }, now, { releaseLocks: true });
      expired.push(booking);
    } catch (error) {
      // Decided or expired by someone else in the meantime.
      if (!(error instanceof BookingError && error.code === "INVALID_STATE")) throw error;
    }
  }
  return expired;
}

/** Pending LAN requests, oldest first, for the owner. */
export async function listPendingRequests(now: Date = new Date()) {
  await ready();
  await expireStaleRequests(now);
  const settings = await loadSettings();
  const pending = await Booking.find({ type: "venue", status: "pending_approval" })
    .sort({ "history.0.at": 1 })
    .lean<BookingRecord[]>();
  return pending.map((b) => ({
    ...toScheduleBooking(b),
    customerEmail: b.customer.email,
    notes: b.notes,
    requestedAt: b.history[0]?.at ?? b.createdAt,
    expiresAt: addMinutes(b.history[0]?.at ?? b.createdAt, settings.venue.approvalTimeoutHours * 60),
  }));
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export interface ScheduleBooking {
  id: string;
  code: string;
  type: BookingRecord["type"];
  status: BookingRecord["status"];
  start: Date;
  end: Date;
  customerName: string;
  customerPhone: string;
  source: BookingRecord["source"];
  partySize?: number;
}

export interface ScheduleRow {
  id: string;
  name: string;
  type: (typeof RESOURCE_TYPES)[number];
  bookableOnline: boolean;
  /** One entry per slot: the id of the booking holding it, or null when free. */
  slots: (string | null)[];
}

export interface DaySchedule {
  date: string;
  timezone: string;
  slotMinutes: number;
  open: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  slotStarts: Date[];
  rows: ScheduleRow[];
  /** Bookings holding slots today, by id. */
  bookings: Record<string, ScheduleBooking>;
  /** Every booking that starts this business day, any status, by start time. */
  dayList: ScheduleBooking[];
}

/**
 * The counter's view of one business day: every active station, including
 * walk-in ones, with the booking holding each slot. Built from slot locks, so
 * it always agrees with availability.
 */
export async function getDaySchedule(date: string, clock: Clock = {}): Promise<DaySchedule> {
  if (!isLocalDate(date)) throw new BookingError("INVALID_INPUT", "date must be YYYY-MM-DD");
  await ready();
  await expireStaleRequests(clock.now ?? new Date());
  const settings = await loadSettings();
  const day = businessDayWindow(date, settings.openingHours, settings.timezone);
  const base = { date, timezone: settings.timezone, slotMinutes: settings.slotMinutes };
  if (!day) {
    return { ...base, open: false, opensAt: null, closesAt: null, slotStarts: [], rows: [], bookings: {}, dayList: [] };
  }

  const resources = await Resource.find({ active: true }).sort({ sortOrder: 1 }).lean();
  const locks = await SlotLock.find({
    resourceId: { $in: resources.map((r) => r._id) },
    slotStart: { $gte: day.open, $lt: day.close },
  })
    .select({ resourceId: 1, slotStart: 1, bookingId: 1, _id: 0 })
    .lean();

  const held = new Map(locks.map((l) => [`${l.resourceId}:${l.slotStart.getTime()}`, String(l.bookingId)]));
  const holdingIds = [...new Set(locks.map((l) => String(l.bookingId)))];

  const [holding, startingToday] = await Promise.all([
    Booking.find({ _id: { $in: holdingIds } }).lean<BookingRecord[]>(),
    Booking.find({ start: { $gte: day.open, $lt: day.close } })
      .sort({ start: 1 })
      .lean<BookingRecord[]>(),
  ]);

  const slotStarts = expandSlots(day.open, day.close, settings.slotMinutes);
  return {
    ...base,
    open: true,
    opensAt: day.open,
    closesAt: day.close,
    slotStarts,
    rows: resources.map((r) => ({
      id: String(r._id),
      name: r.name,
      type: r.type,
      bookableOnline: r.bookableOnline,
      slots: slotStarts.map((slot) => held.get(`${r._id}:${slot.getTime()}`) ?? null),
    })),
    bookings: Object.fromEntries(holding.map((b) => [String(b._id), toScheduleBooking(b)])),
    dayList: startingToday.map(toScheduleBooking),
  };
}

function toScheduleBooking(b: BookingRecord): ScheduleBooking {
  return {
    id: String(b._id),
    code: b.code,
    type: b.type,
    status: b.status,
    start: b.start,
    end: b.end,
    customerName: b.customer.name,
    customerPhone: b.customer.phone,
    source: b.source,
    ...(b.partySize ? { partySize: b.partySize } : {}),
  };
}

const searchSchema = z.object({
  q: z.string().trim().max(80).default(""),
  status: z.enum(BOOKING_STATUSES).optional(),
  /** Business day, YYYY-MM-DD. */
  date: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SearchInput = z.input<typeof searchSchema>;

/** Find bookings by code, customer name or phone, newest first. */
export async function searchBookings(raw: SearchInput): Promise<ScheduleBooking[]> {
  const input = parse(searchSchema, raw);
  await ready();

  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;

  if (input.date) {
    if (!isLocalDate(input.date)) throw new BookingError("INVALID_INPUT", "date must be YYYY-MM-DD");
    const settings = await loadSettings();
    const day = businessDayWindow(input.date, settings.openingHours, settings.timezone);
    if (!day) return [];
    filter.start = { $gte: day.open, $lt: day.close };
  }

  if (input.q) {
    const text = escapeRegex(input.q);
    const digits = input.q.replace(/\D/g, "");
    filter.$or = [
      { code: normalizeBookingCode(input.q) },
      { "customer.name": { $regex: text, $options: "i" } },
      { "customer.email": { $regex: text, $options: "i" } },
      // Phone numbers are typed with or without spaces: match the digits in order.
      ...(digits.length >= 4 ? [{ "customer.phone": { $regex: digits.split("").join("\\D*") } }] : []),
    ];
  }

  const found = await Booking.find(filter).sort({ start: -1 }).limit(input.limit).lean<BookingRecord[]>();
  return found.map(toScheduleBooking);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** History and details for the staff booking page. */
export async function getBookingDetails(code: string) {
  await ready();
  const booking = await findByCode(code);
  const resources = await Resource.find({ _id: { $in: booking.resourceIds } })
    .select({ name: 1, sortOrder: 1, type: 1 })
    .sort({ sortOrder: 1 })
    .lean();
  return {
    ...toScheduleBooking(booking),
    customerEmail: booking.customer.email,
    notes: booking.notes,
    priceEstimate: booking.priceEstimate,
    resources: resources.map((r) => ({ id: String(r._id), name: r.name, type: r.type })),
    history: booking.history,
  };
}

export async function getBookingByCode(code: string): Promise<BookingRecord> {
  await ready();
  return findByCode(code);
}

/** Checks the token from a manage link against the stored hash, in constant time. */
export function verifyManageToken(booking: Pick<BookingRecord, "manageTokenHash">, token: string): boolean {
  const expected = Buffer.from(booking.manageTokenHash, "hex");
  const actual = createHash("sha256").update(token).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface BookingDraft {
  start: Date;
  end: Date;
  customer: BookingRecord["customer"];
  partySize?: number;
  notes?: string;
  source: BookingRecord["source"];
  by: string;
  now: Date;
  /** Defaults: a confirmed station booking whose locks end with it. */
  type?: BookingRecord["type"];
  status?: BookingRecord["status"];
  /** Locks run until here, e.g. to cover the cleanup after a LAN. */
  lockUntil?: Date;
}

const MAX_CODE_ATTEMPTS = 5;

class CodeCollision extends Error {}

/** Inserts the booking and all its locks atomically, or throws SLOT_TAKEN. */
async function insertBooking(
  draft: BookingDraft,
  stations: { _id: Types.ObjectId; hourlyRate: number }[],
  settings: BookingSettings,
): Promise<CreatedBooking> {
  const slots = expandSlots(draft.start, draft.lockUntil ?? draft.end, settings.slotMinutes);
  const manageToken = randomBytes(32).toString("base64url");
  const type = draft.type ?? "station";
  const status = draft.status ?? "confirmed";

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const bookingId = new Types.ObjectId();
    const doc = {
      _id: bookingId,
      code: generateBookingCode(randomInt),
      type,
      resourceIds: stations.map((s) => s._id),
      start: draft.start,
      end: draft.end,
      status,
      customer: draft.customer,
      ...(draft.partySize ? { partySize: draft.partySize } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
      source: draft.source,
      priceEstimate: estimatePrice(
        stations.map((s) => s.hourlyRate),
        draft.start,
        draft.end,
      ),
      manageTokenHash: createHash("sha256").update(manageToken).digest("hex"),
      history: [{ at: draft.now, by: draft.by, from: null, to: status }],
      createdBy: draft.by,
    };

    try {
      await transaction(async (session) => {
        try {
          await Booking.create([doc], { session });
        } catch (error) {
          if (isDuplicateKey(error)) throw new CodeCollision();
          throw error;
        }
        await insertLocks(doc.resourceIds, slots, bookingId, session);
      });
    } catch (error) {
      if (error instanceof CodeCollision) continue;
      throw error;
    }

    const booking = await Booking.findById(bookingId).lean<BookingRecord>();
    if (!booking) throw new Error("booking vanished after commit");
    return { booking, manageToken };
  }

  throw new Error("could not generate a unique booking code");
}

async function insertLocks(
  resourceIds: Types.ObjectId[],
  slots: Date[],
  bookingId: Types.ObjectId,
  session: mongoose.ClientSession,
): Promise<void> {
  try {
    await SlotLock.insertMany(
      resourceIds.flatMap((resourceId) => slots.map((slotStart) => ({ resourceId, slotStart, bookingId }))),
      { session },
    );
  } catch (error) {
    // Only a committed lock produces a duplicate key. A clash with another
    // transaction still in flight is a transient write conflict instead: it is
    // rethrown untouched so the driver retries this transaction.
    if (isDuplicateKey(error)) throw new BookingError("SLOT_TAKEN");
    throw error;
  }
}

async function transaction(work: (session: mongoose.ClientSession) => Promise<void>): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

function isDuplicateKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as {
    code?: number;
    cause?: unknown;
    writeErrors?: { code?: number; err?: { code?: number } }[];
  };
  if (e.code === 11000) return true;
  if (e.writeErrors?.some((w) => w.code === 11000 || w.err?.code === 11000)) return true;
  return e.cause !== undefined && e.cause !== error && isDuplicateKey(e.cause);
}

async function customerStanding(
  customer: { userId?: string; email?: string },
  now: Date,
): Promise<{ blocked: boolean; noShowCount: number; upcomingCount: number }> {
  const identities = [
    ...(customer.userId ? [{ "customer.userId": new Types.ObjectId(customer.userId) }] : []),
    ...(customer.email ? [{ "customer.email": customer.email }] : []),
  ];

  const [user, upcomingCount] = await Promise.all([
    customer.userId
      ? User.findById(customer.userId).select({ blocked: 1, noShowCount: 1 }).lean()
      : customer.email
        ? User.findOne({ email: customer.email }).select({ blocked: 1, noShowCount: 1 }).lean()
        : null,
    // A soft limit: two simultaneous requests by one customer can both pass it.
    // Slot conflicts are the hard guarantee, not this count.
    identities.length > 0
      ? Booking.countDocuments({
          $or: identities,
          status: { $in: LOCK_HOLDING_STATUSES },
          end: { $gt: now },
        })
      : 0,
  ]);

  return {
    blocked: user?.blocked ?? false,
    noShowCount: user?.noShowCount ?? 0,
    upcomingCount,
  };
}

async function findByCode(code: string): Promise<BookingRecord> {
  const booking = await Booking.findOne({ code: normalizeBookingCode(code) }).lean<BookingRecord>();
  if (!booking) throw new BookingError("NOT_FOUND", "no booking with this code");
  return booking;
}

async function loadSettings(): Promise<BookingSettings> {
  const settings = await Settings.findOne({ key: "default" }).lean();
  if (!settings) throw new Error("Settings are missing. Run `pnpm seed` first.");
  // The schema marks every one of these fields as required.
  return settings as unknown as BookingSettings;
}

let indexesReady: Promise<void> | undefined;

/**
 * Connects and makes sure the unique indexes exist before the first write.
 * Without the slotLocks index there is no double-booking guarantee, so no
 * booking is ever written until it has been built.
 */
async function ready(): Promise<void> {
  await connectDb();
  indexesReady ??= Promise.all([Booking.init(), SlotLock.init()]).then(
    () => undefined,
    (error) => {
      indexesReady = undefined;
      throw error;
    },
  );
  await indexesReady;
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new BookingError("INVALID_INPUT", `${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data;
}

function kindOf(actor: Actor): ActorKind {
  return actor.role === "customer" ? "customer" : "staff";
}

function actorLabel(actor: Actor): string {
  return actor.userId ? `${actor.role}:${actor.userId}` : actor.role;
}
