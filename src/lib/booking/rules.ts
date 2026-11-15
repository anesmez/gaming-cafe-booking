import { addMinutes, floorToSlot, isSlotAligned, minutesBetween, resolveBusinessDay } from "./time";
import {
  BookingError,
  LOCK_HOLDING_STATUSES,
  type ActorKind,
  type BookingSettings,
  type BookingStatus,
  type BookingType,
} from "./types";

/**
 * Booking rules from "Resources and booking rules" in docs/SPEC.md.
 * Pure: the caller supplies the settings and the current time.
 *
 * Staff are exempt from the customer-facing limits (lead time, booking window,
 * station count, cancellation cutoff) but never from opening hours, slot
 * alignment or duration limits. Nobody is exempt from slot conflicts; those
 * are enforced by the database, not here.
 */

const DAY_MINUTES = 24 * 60;

export interface StationBookingRequest {
  start: Date;
  end: Date;
  stationCount: number;
  actor: ActorKind;
}

export function validateStationBooking(
  request: StationBookingRequest,
  settings: BookingSettings,
  now: Date,
): void {
  const { start, end, stationCount, actor } = request;
  const { slotMinutes, station } = settings;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BookingError("INVALID_INPUT", "start and end must be valid dates");
  }
  if (!isSlotAligned(start, slotMinutes) || !isSlotAligned(end, slotMinutes)) {
    throw new BookingError("INVALID_INPUT", `start and end must fall on ${slotMinutes}-minute slots`);
  }
  if (!Number.isInteger(stationCount) || stationCount < 1) {
    throw new BookingError("INVALID_INPUT", "at least one station is required");
  }

  const duration = minutesBetween(start, end);
  if (duration < station.minMinutes || duration > station.maxMinutes) {
    throw new BookingError(
      "INVALID_DURATION",
      `duration must be between ${station.minMinutes} and ${station.maxMinutes} minutes`,
    );
  }

  if (actor === "customer") {
    if (stationCount > station.maxStationsPerBooking) {
      throw new BookingError("TOO_MANY_STATIONS");
    }
    if (start < addMinutes(now, station.minLeadMinutes)) {
      throw new BookingError("TOO_SOON");
    }
    if (start > addMinutes(now, station.maxAdvanceDays * DAY_MINUTES)) {
      throw new BookingError("TOO_FAR");
    }
  } else if (start < floorToSlot(now, slotMinutes)) {
    // Staff can seat a walk-in in the slot that is already running, not earlier.
    throw new BookingError("TOO_SOON", "a booking cannot start in a past slot");
  }

  assertWithinOpeningHours(start, end, settings);
}

/** The whole range must sit inside one business day's opening window. */
export function assertWithinOpeningHours(
  start: Date,
  end: Date,
  settings: Pick<BookingSettings, "openingHours" | "timezone">,
): void {
  const day = resolveBusinessDay(start, settings);
  if (!day || end > day.close) throw new BookingError("OUTSIDE_HOURS");
}

export interface CustomerStanding {
  blocked: boolean;
  noShowCount: number;
  /** Bookings by this customer that have not ended and still hold slots. */
  upcomingCount: number;
}

export function assertCustomerMayBook(standing: CustomerStanding, settings: BookingSettings): void {
  if (standing.blocked || standing.noShowCount >= settings.noShowLimit) {
    throw new BookingError("BLOCKED");
  }
  if (standing.upcomingCount >= settings.maxUpcomingPerCustomer) {
    throw new BookingError("LIMIT_REACHED");
  }
}

export interface CancellableBooking {
  type: BookingType;
  status: BookingStatus;
  start: Date;
  end: Date;
}

/**
 * Customers can cancel until the cutoff before start; after that only staff
 * can. Staff can cancel anything that still holds slots and has not ended.
 */
export function assertCancellable(
  booking: CancellableBooking,
  actor: ActorKind,
  settings: BookingSettings,
  now: Date,
): void {
  if (!holdsLocks(booking.status)) {
    throw new BookingError("INVALID_STATE", `a ${booking.status} booking cannot be cancelled`);
  }
  if (now >= booking.end) {
    throw new BookingError("INVALID_STATE", "the booking has already ended");
  }
  if (actor === "customer") {
    if (booking.status === "checked_in") {
      throw new BookingError("CUTOFF_PASSED");
    }
    const cutoffMinutes =
      booking.type === "venue"
        ? settings.venue.cancelCutoffHours * 60
        : settings.station.cancelCutoffMinutes;
    if (now > addMinutes(booking.start, -cutoffMinutes)) {
      throw new BookingError("CUTOFF_PASSED");
    }
  }
}

export function holdsLocks(status: BookingStatus): boolean {
  return (LOCK_HOLDING_STATUSES as readonly BookingStatus[]).includes(status);
}
