import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { BookingSettings, OpeningHours } from "./types";

/**
 * Time math for the booking engine. Every function takes the venue timezone
 * explicitly; nothing here reads the server's local time or the current time.
 */

const MINUTE_MS = 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date in the venue timezone, "YYYY-MM-DD". */
export type LocalDate = string;

export interface BusinessDay {
  /** The business day a booking belongs to: the local date the venue opened on. */
  date: LocalDate;
  /** Opening instant (UTC). */
  open: Date;
  /** Closing instant (UTC). May fall on the next calendar day. */
  close: Date;
}

export function isLocalDate(value: string): value is LocalDate {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // Round-trip so impossible dates such as 2026-02-30 are rejected, not rolled over.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The venue-local calendar date of an instant. */
export function localDateOf(instant: Date, timezone: string): LocalDate {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

/** Venue-local wall time ("YYYY-MM-DD", "HH:mm") to a UTC instant. */
export function localTimeToUtc(date: LocalDate, time: string, timezone: string): Date {
  return fromZonedTime(`${date}T${time}:00`, timezone);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a venue-local calendar date. */
export function weekdayOf(date: LocalDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * The opening window of one business day, or null when the venue is closed
 * that weekday. A close time at or before the open time means "next day":
 * open 10:00, close 02:00 runs from 10:00 until 02:00 the following morning.
 */
export function businessDayWindow(
  date: LocalDate,
  openingHours: OpeningHours[],
  timezone: string,
): BusinessDay | null {
  const hours = openingHours.find((h) => h.weekday === weekdayOf(date));
  if (!hours) return null;

  const closesNextDay = hours.close <= hours.open;
  return {
    date,
    open: localTimeToUtc(date, hours.open, timezone),
    close: localTimeToUtc(closesNextDay ? addDays(date, 1) : date, hours.close, timezone),
  };
}

/**
 * The business day an instant falls in, or null when the venue is closed then.
 * 00:30 on Wednesday belongs to Tuesday's business day if Tuesday closes at 02:00.
 */
export function resolveBusinessDay(
  instant: Date,
  settings: Pick<BookingSettings, "openingHours" | "timezone">,
): BusinessDay | null {
  const today = localDateOf(instant, settings.timezone);
  for (const date of [addDays(today, -1), today]) {
    const window = businessDayWindow(date, settings.openingHours, settings.timezone);
    if (window && instant >= window.open && instant < window.close) return window;
  }
  return null;
}

/**
 * True when the instant sits exactly on a slot boundary. Slots are aligned on
 * the UTC epoch, which matches venue wall-clock :00 / :30 for every timezone
 * whose offset is a multiple of the slot size (Africa/Algiers is UTC+1).
 */
export function isSlotAligned(instant: Date, slotMinutes: number): boolean {
  return instant.getTime() % (slotMinutes * MINUTE_MS) === 0;
}

/** The start of the slot that contains the instant. */
export function floorToSlot(instant: Date, slotMinutes: number): Date {
  const size = slotMinutes * MINUTE_MS;
  return new Date(Math.floor(instant.getTime() / size) * size);
}

/** Slot start instants covering [start, end). Both must be slot-aligned. */
export function expandSlots(start: Date, end: Date, slotMinutes: number): Date[] {
  const size = slotMinutes * MINUTE_MS;
  const slots: Date[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += size) slots.push(new Date(t));
  return slots;
}

export function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / MINUTE_MS;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS);
}
