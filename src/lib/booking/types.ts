/**
 * Shared types for the booking engine. Pure: no database imports.
 * Field names follow the data model in docs/SPEC.md.
 */

export interface OpeningHours {
  /** 0 = Sunday … 6 = Saturday, in the venue timezone. */
  weekday: number;
  /** "HH:mm" in the venue timezone. */
  open: string;
  /** "HH:mm". When close <= open, the venue closes on the next calendar day. */
  close: string;
}

export interface StationRules {
  minMinutes: number;
  maxMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  cancelCutoffMinutes: number;
  maxStationsPerBooking: number;
}

export interface VenueRules {
  minMinutes: number;
  minLeadHours: number;
  maxAdvanceDays: number;
  cancelCutoffHours: number;
  approvalTimeoutHours: number;
  bufferMinutes: number;
}

export interface BookingSettings {
  timezone: string;
  slotMinutes: number;
  openingHours: OpeningHours[];
  station: StationRules;
  venue: VenueRules;
  graceMinutes: number;
  maxUpcomingPerCustomer: number;
  noShowLimit: number;
}

export const BOOKING_TYPES = ["station", "venue", "block"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const BOOKING_STATUSES = [
  "pending_approval",
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "rejected",
  "expired",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses whose bookings hold their slot locks. */
export const LOCK_HOLDING_STATUSES = ["pending_approval", "confirmed", "checked_in"] as const;

export const BOOKING_SOURCES = ["online", "phone", "whatsapp", "walkin"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/**
 * Who is acting. Staff and owner share the same booking rights; only customers
 * are subject to lead time, booking window, station count and cutoff rules.
 */
export type ActorKind = "customer" | "staff";

/** Stable codes the UI translates. Keep in sync with "Routes and API" in the spec. */
export const BOOKING_ERROR_CODES = [
  "SLOT_TAKEN",
  "OUTSIDE_HOURS",
  "TOO_SOON",
  "TOO_FAR",
  "LIMIT_REACHED",
  "BLOCKED",
  "CUTOFF_PASSED",
  "INVALID_INPUT",
  "INVALID_DURATION",
  "TOO_MANY_STATIONS",
  "NOT_FOUND",
  "INVALID_STATE",
  "FORBIDDEN",
] as const;
export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BookingError";
  }
}
