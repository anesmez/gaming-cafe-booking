import { z } from "zod";
import { hasRole } from "@/lib/auth/roles";
import { BookingError, addMinutes, durationOptions, type BookingSettings } from "@/lib/booking";
import { RESOURCE_TYPES } from "./models/resource";
import { cancelBooking, createBooking, getBookingByCode, requestVenueBooking, verifyManageToken } from "./booking-service";
import { connectDb } from "./db";
import { notify } from "./email/notify";
import type { BookingRecord } from "./models/booking";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { User } from "./models/user";
import type { SessionUser } from "./session";

/**
 * The customer-facing side of the booking engine: what the public pages and
 * their server actions call. All writes to bookings still go through
 * booking-service.ts.
 */

export interface PublicSettings {
  venueName: string;
  address: string;
  timezone: string;
  currency: string;
  slotMinutes: number;
  station: BookingSettings["station"];
  openingHours: BookingSettings["openingHours"];
  graceMinutes: number;
  venue: BookingSettings["venue"];
}

export async function getPublicSettings(): Promise<PublicSettings | null> {
  await connectDb();
  const s = await Settings.findOne({ key: "default" }).lean();
  if (!s) return null;
  return {
    venueName: s.venueName,
    address: s.address ?? "",
    timezone: s.timezone,
    currency: s.currency,
    slotMinutes: s.slotMinutes,
    station: s.station as BookingSettings["station"],
    openingHours: s.openingHours.map((h) => ({ weekday: h.weekday, open: h.open, close: h.close })),
    graceMinutes: s.graceMinutes,
    venue: s.venue as BookingSettings["venue"],
  };
}

/** Starting hourly price per resource type, for the home page. Types with no price set are left out. */
export async function getPublicPrices(): Promise<Partial<Record<(typeof RESOURCE_TYPES)[number], number>>> {
  await connectDb();
  const rows = await Resource.aggregate<{ _id: (typeof RESOURCE_TYPES)[number]; from: number }>([
    { $match: { active: true, hourlyRate: { $gt: 0 } } },
    { $group: { _id: "$type", from: { $min: "$hourlyRate" } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.from]));
}

const placeSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  start: z.iso.datetime().transform((v) => new Date(v)),
  durationMinutes: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(1).max(10),
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{9,20}$/),
});
export type PlaceBookingInput = z.input<typeof placeSchema>;

export type PlaceResult =
  | { ok: true; code: string; manageToken: string }
  | { ok: false; error: BookingError["code"] };

/**
 * Books for a logged-in customer (the session proves the email address).
 * Sends the confirmation email; the booking stands even if that fails.
 */
export async function placeOnlineBooking(
  user: Pick<SessionUser, "id" | "email">,
  raw: PlaceBookingInput,
  now: Date = new Date(),
): Promise<PlaceResult> {
  const parsed = placeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const input = parsed.data;

  const settings = await getPublicSettings();
  if (!settings) return { ok: false, error: "INVALID_STATE" };
  if (!durationOptions(settings.station, settings.slotMinutes).includes(input.durationMinutes)) {
    return { ok: false, error: "INVALID_DURATION" };
  }
  // The PS5 is one console: a booking always takes exactly it.
  const count = input.resourceType === "console" ? 1 : input.count;

  try {
    const { booking, manageToken } = await createBooking(
      {
        actor: { role: "customer", userId: user.id },
        stations: { mode: "auto", resourceType: input.resourceType, count },
        start: input.start,
        end: addMinutes(input.start, input.durationMinutes),
        customer: { userId: user.id, name: input.name, phone: input.phone, email: user.email },
        source: "online",
      },
      { now },
    );

    // Remember name and phone so the next booking is pre-filled.
    await User.updateOne({ _id: user.id }, { $set: { name: input.name, phone: input.phone } });
    await notify({ type: "booking_confirmed", booking, manageToken });

    return { ok: true, code: booking.code, manageToken };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.code };
    throw error;
  }
}

const lanSchema = z.object({
  start: z.iso.datetime().transform((v) => new Date(v)),
  durationMinutes: z.coerce.number().int().positive(),
  partySize: z.coerce.number().int().min(2).max(100),
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{9,20}$/),
  notes: z.string().trim().max(500).default(""),
});
export type LanRequestInput = z.input<typeof lanSchema>;

/** A logged-in customer asks for the whole venue. Emails the customer and the owner. */
export async function placeLanRequest(
  user: Pick<SessionUser, "id" | "email">,
  raw: LanRequestInput,
  now: Date = new Date(),
): Promise<PlaceResult> {
  const parsed = lanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const input = parsed.data;
  if (input.durationMinutes % 30 !== 0) return { ok: false, error: "INVALID_DURATION" };

  try {
    const { booking, manageToken } = await requestVenueBooking(
      {
        actor: { role: "customer", userId: user.id },
        start: input.start,
        end: addMinutes(input.start, input.durationMinutes),
        customer: { userId: user.id, name: input.name, phone: input.phone, email: user.email },
        partySize: input.partySize,
        ...(input.notes ? { notes: input.notes } : {}),
      },
      { now },
    );
    await User.updateOne({ _id: user.id }, { $set: { name: input.name, phone: input.phone } });
    await notify({ type: "lan_requested", booking, manageToken });
    return { ok: true, code: booking.code, manageToken };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.code };
    throw error;
  }
}

/** Who may see and cancel a booking from its page. */
export type Access = "token" | "owner" | "staff" | null;

function accessFor(booking: BookingRecord, token: string | undefined, user: SessionUser | null): Access {
  if (user && hasRole(user.role, "staff")) return "staff";
  if (token && verifyManageToken(booking, token)) return "token";
  if (user && booking.customer.userId && String(booking.customer.userId) === user.id) return "owner";
  return null;
}

export interface ManagedBooking {
  access: Exclude<Access, null>;
  code: string;
  status: BookingRecord["status"];
  type: BookingRecord["type"];
  start: Date;
  end: Date;
  stationNames: string[];
  priceEstimate: number;
  quotedPrice?: number;
  partySize?: number;
  customerName: string;
  /** Last moment a customer can cancel online. */
  cancelUntil: Date;
}

/**
 * The booking behind a manage link, or null when the code does not exist or
 * the visitor may not see it. The two cases look the same from outside.
 */
export async function loadManagedBooking(
  code: string,
  token: string | undefined,
  user: SessionUser | null,
): Promise<ManagedBooking | null> {
  let booking: BookingRecord;
  try {
    booking = await getBookingByCode(code);
  } catch (error) {
    if (error instanceof BookingError && error.code === "NOT_FOUND") return null;
    throw error;
  }

  const access = accessFor(booking, token, user);
  if (!access) return null;

  const [settings, stations] = await Promise.all([
    getPublicSettings(),
    Resource.find({ _id: { $in: booking.resourceIds } }).select({ name: 1, sortOrder: 1 }).sort({ sortOrder: 1 }).lean(),
  ]);
  const cutoff =
    booking.type === "venue"
      ? (settings?.venue.cancelCutoffHours ?? 0) * 60
      : (settings?.station.cancelCutoffMinutes ?? 0);

  return {
    access,
    code: booking.code,
    status: booking.status,
    type: booking.type,
    start: booking.start,
    end: booking.end,
    stationNames: stations.map((s) => s.name),
    priceEstimate: booking.priceEstimate,
    ...(booking.quotedPrice !== undefined ? { quotedPrice: booking.quotedPrice } : {}),
    ...(booking.partySize ? { partySize: booking.partySize } : {}),
    customerName: booking.customer.name,
    cancelUntil: addMinutes(booking.start, -cutoff),
  };
}

export async function cancelManagedBooking(
  code: string,
  token: string | undefined,
  user: SessionUser | null,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: BookingError["code"] }> {
  const managed = await loadManagedBooking(code, token, user);
  if (!managed) return { ok: false, error: "NOT_FOUND" };

  try {
    const cancelled = await cancelBooking(
      {
        code,
        actor:
          managed.access === "staff"
            ? { role: user!.role, userId: user!.id }
            : { role: "customer", ...(user && managed.access === "owner" ? { userId: user.id } : {}) },
      },
      { now },
    );
    await notify({ type: "booking_cancelled", booking: cancelled, byCustomer: managed.access !== "staff" });
    return { ok: true };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.code };
    throw error;
  }
}

/** Name and phone from the last booking, to pre-fill the form. */
export async function getCustomerProfile(userId: string): Promise<{ name: string; phone: string }> {
  await connectDb();
  const user = await User.findById(userId).select({ name: 1, phone: 1 }).lean();
  return { name: user?.name ?? "", phone: user?.phone ?? "" };
}
