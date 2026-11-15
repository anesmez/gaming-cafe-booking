import { Types } from "mongoose";
import { z } from "zod";
import { BookingError, type EditableSettings } from "@/lib/booking";
import type { Actor } from "./booking-service";
import { connectDb } from "./db";
import { Booking } from "./models/booking";
import { RESOURCE_TYPES, Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";

/**
 * The owner's configuration: settings, stations, staff accounts, and the
 * customer list with its blocklist. None of this writes bookings or slot locks
 * (that stays in booking-service.ts); it only reads locks to refuse changes
 * that would strand a booking.
 */

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

function requireOwner(actor: Actor) {
  if (actor.role !== "owner") throw new BookingError("FORBIDDEN", "owner only");
}
function requireStaff(actor: Actor) {
  if (actor.role === "customer")
    throw new BookingError("FORBIDDEN", "staff only");
}
function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new BookingError("INVALID_INPUT", result.error.issues[0]?.message);
  return result.data;
}
function isDuplicateKey(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getEditableSettings(): Promise<
  (EditableSettings & { slotMinutes: number; currency: string }) | null
> {
  await connectDb();
  const s = await Settings.findOne({ key: "default" }).lean();
  if (!s) return null;
  return {
    venueName: s.venueName,
    address: s.address ?? "",
    slotMinutes: s.slotMinutes,
    currency: s.currency,
    openingHours: s.openingHours.map((h) => ({
      weekday: h.weekday,
      open: h.open,
      close: h.close,
    })),
    station: s.station as EditableSettings["station"],
    venue: s.venue as EditableSettings["venue"],
    graceMinutes: s.graceMinutes,
    maxUpcomingPerCustomer: s.maxUpcomingPerCustomer,
    noShowLimit: s.noShowLimit,
  };
}

/**
 * Saves already validated settings (see toStoredSettings). Applies to new
 * bookings at once; bookings already made keep their times.
 */
export async function saveSettings(
  actor: Actor,
  settings: EditableSettings,
): Promise<void> {
  requireOwner(actor);
  await connectDb();
  const result = await Settings.updateOne(
    { key: "default" },
    { $set: settings },
  );
  if (result.matchedCount !== 1)
    throw new BookingError("NOT_FOUND", "settings are missing");
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export interface StationRow {
  id: string;
  type: (typeof RESOURCE_TYPES)[number];
  name: string;
  hourlyRate: number;
  bookableOnline: boolean;
  active: boolean;
  sortOrder: number;
  /** Bookings or closures that still hold this station's future slots. */
  upcoming: number;
}

export async function listStations(
  now: Date = new Date(),
): Promise<StationRow[]> {
  await connectDb();
  const resources = await Resource.find()
    .sort({ active: -1, sortOrder: 1 })
    .lean();
  const counts = await SlotLock.aggregate<{
    _id: Types.ObjectId;
    bookings: Types.ObjectId[];
  }>([
    { $match: { slotStart: { $gte: now } } },
    { $group: { _id: "$resourceId", bookings: { $addToSet: "$bookingId" } } },
  ]);
  const upcoming = new Map(
    counts.map((c) => [String(c._id), c.bookings.length]),
  );
  return resources.map((r) => ({
    id: String(r._id),
    type: r.type,
    name: r.name,
    hourlyRate: r.hourlyRate,
    bookableOnline: r.bookableOnline,
    active: r.active,
    sortOrder: r.sortOrder,
    upcoming: upcoming.get(String(r._id)) ?? 0,
  }));
}

const stationFields = z.object({
  name: z.string().trim().min(1).max(30),
  hourlyRate: z.coerce.number().int().min(0).max(100_000),
  bookableOnline: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export const newStationSchema = stationFields.extend({
  type: z.enum(RESOURCE_TYPES),
});
export type NewStation = z.input<typeof newStationSchema>;

export async function createStation(
  actor: Actor,
  raw: NewStation,
): Promise<void> {
  requireOwner(actor);
  const input = parse(newStationSchema, raw);
  await connectDb();
  try {
    await Resource.create({ ...input, active: true });
  } catch (error) {
    if (isDuplicateKey(error))
      throw new BookingError("INVALID_INPUT", "NAME_TAKEN");
    throw error;
  }
}

export const stationUpdateSchema = stationFields.extend({
  id: objectId,
  active: z.boolean(),
});
export type StationUpdate = z.input<typeof stationUpdateSchema>;

/**
 * Edits a station. Deactivating one that still holds future slots is refused:
 * those bookings would vanish from the grid. Move them first.
 */
export async function updateStation(
  actor: Actor,
  raw: StationUpdate,
  now: Date = new Date(),
): Promise<void> {
  requireOwner(actor);
  const { id, ...fields } = parse(stationUpdateSchema, raw);
  await connectDb();
  const current = await Resource.findById(id).lean();
  if (!current) throw new BookingError("NOT_FOUND", "no such station");

  if (current.active && !fields.active) {
    const held = await SlotLock.exists({
      resourceId: current._id,
      slotStart: { $gte: now },
    });
    if (held) throw new BookingError("INVALID_STATE", "STATION_IN_USE");
  }
  try {
    await Resource.updateOne({ _id: current._id }, { $set: fields });
  } catch (error) {
    if (isDuplicateKey(error))
      throw new BookingError("INVALID_INPUT", "NAME_TAKEN");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Staff accounts
// ---------------------------------------------------------------------------

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: "staff" | "owner";
}

export async function listTeam(): Promise<TeamMember[]> {
  await connectDb();
  const users = await User.find({ role: { $in: ["staff", "owner"] } })
    .sort({ role: 1, email: 1 }) // "owner" sorts before "staff"
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    email: u.email,
    name: u.name ?? "",
    role: u.role as TeamMember["role"],
  }));
}

/**
 * Gives an email address the staff role. The person logs in with a code like
 * anyone else; no password is ever set. An existing customer is promoted.
 */
export async function addStaff(actor: Actor, rawEmail: string): Promise<void> {
  requireOwner(actor);
  const email = parse(
    z.string().trim().toLowerCase().pipe(z.email()),
    rawEmail,
  );
  await connectDb();
  await User.init();
  const existing = await User.findOne({ email }).select({ role: 1 }).lean();
  if (existing?.role === "owner") return;
  await User.updateOne(
    { email },
    {
      $set: { role: "staff" },
      $setOnInsert: { name: "", phone: "", noShowCount: 0, blocked: false },
    },
    { upsert: true },
  );
}

/** Back to a customer. The owner keeps their role. Takes effect on the next page. */
export async function removeStaff(actor: Actor, userId: string): Promise<void> {
  requireOwner(actor);
  const id = parse(objectId, userId);
  await connectDb();
  const result = await User.updateOne(
    { _id: id, role: "staff" },
    { $set: { role: "customer" } },
  );
  if (result.matchedCount !== 1)
    throw new BookingError("NOT_FOUND", "no such staff member");
}

// ---------------------------------------------------------------------------
// Customers and blocklist
// ---------------------------------------------------------------------------

export interface CustomerRow {
  id: string;
  email: string;
  name: string;
  phone: string;
  bookings: number;
  noShowCount: number;
  /** Blocked by staff, or by reaching the no-show limit. */
  blocked: boolean;
  blockedByStaff: boolean;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listCustomers(raw: {
  q?: string;
  blockedOnly?: boolean;
}): Promise<CustomerRow[]> {
  const input = parse(
    z.object({
      q: z.string().trim().max(80).default(""),
      blockedOnly: z.boolean().default(false),
    }),
    raw,
  );
  await connectDb();
  const settings = await Settings.findOne({ key: "default" })
    .select({ noShowLimit: 1 })
    .lean();
  const limit = settings?.noShowLimit ?? 3;

  const filter: Record<string, unknown> = { role: "customer" };
  if (input.q) {
    const re = new RegExp(escapeRegex(input.q), "i");
    filter.$or = [{ email: re }, { name: re }, { phone: re }];
  }
  if (input.blockedOnly)
    filter.$and = [
      { $or: [{ blocked: true }, { noShowCount: { $gte: limit } }] },
    ];

  const users = await User.find(filter)
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  const counts = await Booking.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { "customer.userId": { $in: users.map((u) => u._id) } } },
    { $group: { _id: "$customer.userId", n: { $sum: 1 } } },
  ]);
  const byUser = new Map(counts.map((c) => [String(c._id), c.n]));

  return users.map((u) => ({
    id: String(u._id),
    email: u.email,
    name: u.name ?? "",
    phone: u.phone ?? "",
    bookings: byUser.get(String(u._id)) ?? 0,
    noShowCount: u.noShowCount,
    blocked: u.blocked || u.noShowCount >= limit,
    blockedByStaff: u.blocked,
  }));
}

/** Staff can block and unblock. Unblocking also clears the no-show count. */
export async function setCustomerBlocked(
  actor: Actor,
  userId: string,
  blocked: boolean,
): Promise<void> {
  requireStaff(actor);
  const id = parse(objectId, userId);
  await connectDb();
  const result = await User.updateOne(
    { _id: id, role: "customer" },
    { $set: blocked ? { blocked: true } : { blocked: false, noShowCount: 0 } },
  );
  if (result.matchedCount !== 1)
    throw new BookingError("NOT_FOUND", "no such customer");
}
