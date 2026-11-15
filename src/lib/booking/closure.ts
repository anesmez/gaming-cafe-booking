import {
  addDays,
  businessDayWindow,
  expandSlots,
  isLocalDate,
  type BusinessDay,
  type LocalDate,
} from "./time";
import { BookingError, type BookingSettings } from "./types";

/** Longest closure in one go. Longer breaks: deactivate the station instead. */
export const MAX_CLOSURE_DAYS = 62;

/**
 * The opening windows a closure covers: every business day from `from` to `to`
 * inclusive that the venue is open. A closed day needs no lock. Pure.
 */
export function closureWindows(
  from: LocalDate,
  to: LocalDate,
  settings: Pick<BookingSettings, "openingHours" | "timezone">,
): BusinessDay[] {
  if (!isLocalDate(from) || !isLocalDate(to))
    throw new BookingError("INVALID_INPUT", "dates must be YYYY-MM-DD");
  if (to < from)
    throw new BookingError(
      "INVALID_INPUT",
      "the closure ends before it starts",
    );

  const windows: BusinessDay[] = [];
  for (let date = from, n = 0; date <= to; date = addDays(date, 1), n++) {
    if (n >= MAX_CLOSURE_DAYS)
      throw new BookingError(
        "TOO_FAR",
        `a closure covers at most ${MAX_CLOSURE_DAYS} days`,
      );
    const window = businessDayWindow(
      date,
      settings.openingHours,
      settings.timezone,
    );
    if (window) windows.push(window);
  }
  return windows;
}

/** Every slot a closure locks. */
export function closureSlots(
  windows: BusinessDay[],
  slotMinutes: number,
): Date[] {
  return windows.flatMap((w) => expandSlots(w.open, w.close, slotMinutes));
}
