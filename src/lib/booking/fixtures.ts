import type { BookingSettings } from "./types";

/** Test fixture mirroring the seed defaults: open 10:00, close 02:00 next day. */
export function testSettings(overrides: Partial<BookingSettings> = {}): BookingSettings {
  return {
    timezone: "Africa/Algiers", // UTC+1, no daylight saving
    slotMinutes: 30,
    openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: "10:00",
      close: "02:00",
    })),
    station: {
      minMinutes: 60,
      maxMinutes: 360,
      minLeadMinutes: 30,
      maxAdvanceDays: 14,
      cancelCutoffMinutes: 120,
      maxStationsPerBooking: 5,
    },
    venue: {
      minMinutes: 180,
      minLeadHours: 48,
      maxAdvanceDays: 60,
      cancelCutoffHours: 48,
      approvalTimeoutHours: 24,
      bufferMinutes: 30,
    },
    graceMinutes: 15,
    maxUpcomingPerCustomer: 2,
    noShowLimit: 3,
    ...overrides,
  };
}

/** Venue-local wall time on a date, as a UTC instant. Algiers is UTC+1 all year. */
export function algiers(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+01:00`);
}
