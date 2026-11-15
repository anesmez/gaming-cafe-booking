import { addDays, addMinutes, businessDayWindow, localDateOf, resolveBusinessDay, type LocalDate } from "./time";
import type { BookingSettings, StationRules } from "./types";

/**
 * What the public booking page offers: which days, which durations, which
 * start times. Pure, so the page and the tests agree on the rules.
 * The booking engine re-checks everything on submit; this only decides what
 * to show.
 */

const DAY_MINUTES = 24 * 60;

/** Business days a customer can book, starting with the one that is running now. */
export function bookableDates(
  now: Date,
  settings: Pick<BookingSettings, "openingHours" | "timezone" | "station">,
): LocalDate[] {
  const current = resolveBusinessDay(now, settings)?.date ?? localDateOf(now, settings.timezone);
  const dates: LocalDate[] = [];
  for (let i = 0; i <= settings.station.maxAdvanceDays; i++) {
    const date = addDays(current, i);
    if (businessDayWindow(date, settings.openingHours, settings.timezone)) dates.push(date);
  }
  return dates;
}

/** Allowed durations in minutes, e.g. 60, 90, … 360. */
export function durationOptions(station: Pick<StationRules, "minMinutes" | "maxMinutes">, slotMinutes: number): number[] {
  const options: number[] = [];
  for (let m = station.minMinutes; m <= station.maxMinutes; m += slotMinutes) options.push(m);
  return options;
}

export interface DayGrid {
  slotStarts: Date[];
  /** One row per station, one entry per slot: true when free. */
  resources: { free: boolean[] }[];
}

export interface StartOption {
  start: Date;
  end: Date;
  /** Stations free for the whole range. Always at least the requested count. */
  freeStations: number;
}

/**
 * Start times where `count` stations are free for the whole duration, the
 * session ends by closing time, and the start respects the booking window.
 */
export function bookableStarts(
  grid: DayGrid,
  options: {
    durationMinutes: number;
    count: number;
    slotMinutes: number;
    now: Date;
    station: Pick<StationRules, "minLeadMinutes" | "maxAdvanceDays">;
  },
): StartOption[] {
  const { durationMinutes, count, slotMinutes, now, station } = options;
  const span = durationMinutes / slotMinutes;
  if (!Number.isInteger(span) || span < 1 || count < 1) return [];

  const earliest = addMinutes(now, station.minLeadMinutes);
  const latest = addMinutes(now, station.maxAdvanceDays * DAY_MINUTES);
  const result: StartOption[] = [];

  for (let i = 0; i + span <= grid.slotStarts.length; i++) {
    const start = grid.slotStarts[i];
    if (start < earliest || start > latest) continue;

    let freeStations = 0;
    for (const resource of grid.resources) {
      let free = true;
      for (let j = i; j < i + span; j++) {
        if (!resource.free[j]) {
          free = false;
          break;
        }
      }
      if (free) freeStations++;
    }

    if (freeStations >= count) {
      result.push({ start, end: addMinutes(start, durationMinutes), freeStations });
    }
  }
  return result;
}

/**
 * Start times for a full-venue request: every station free from the start
 * until the end of the cleanup buffer (cut at closing time), and the start
 * at least `minLeadHours` away.
 */
export function venueStarts(
  grid: DayGrid,
  options: {
    durationMinutes: number;
    bufferMinutes: number;
    slotMinutes: number;
    now: Date;
    venue: { minLeadHours: number; maxAdvanceDays: number };
  },
): { start: Date; end: Date }[] {
  const { durationMinutes, bufferMinutes, slotMinutes, now, venue } = options;
  const span = durationMinutes / slotMinutes;
  const buffer = Math.ceil(bufferMinutes / slotMinutes);
  if (!Number.isInteger(span) || span < 1 || grid.resources.length === 0) return [];

  const earliest = addMinutes(now, venue.minLeadHours * 60);
  const latest = addMinutes(now, venue.maxAdvanceDays * DAY_MINUTES);
  const result: { start: Date; end: Date }[] = [];

  for (let i = 0; i + span <= grid.slotStarts.length; i++) {
    const start = grid.slotStarts[i];
    if (start < earliest || start > latest) continue;
    const until = Math.min(i + span + buffer, grid.slotStarts.length);
    const allFree = grid.resources.every((r) => {
      for (let j = i; j < until; j++) if (!r.free[j]) return false;
      return true;
    });
    if (allFree) result.push({ start, end: addMinutes(start, durationMinutes) });
  }
  return result;
}

/** LAN durations: from the minimum up to the longest opening of the week. */
export function venueDurationOptions(minMinutes: number, maxMinutes: number, slotMinutes: number): number[] {
  const options: number[] = [];
  for (let m = minMinutes; m <= maxMinutes; m += slotMinutes) options.push(m);
  return options;
}
