import { z } from "zod";
import type { BookingSettings, OpeningHours } from "./types";

/**
 * The owner's settings form. Fields are in the units a person thinks in
 * (hours for durations, minutes for short delays); `toStoredSettings` converts
 * them to the stored shape. Pure: no database, no clock.
 *
 * Not editable here, on purpose: the slot size (every lock in the database is
 * aligned to it), the timezone, the currency and the language.
 */

const DAY_MINUTES = 24 * 60;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const int = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);
const hours = (min: number, max: number) => z.coerce.number().min(min).max(max);

const daySchema = z.object({
  closed: z.boolean(),
  open: z.string(),
  close: z.string(),
});

export const settingsFormSchema = z.object({
  venueName: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200),
  /** Index = weekday, 0 = Sunday. */
  days: z.array(daySchema).length(7),
  stationMinHours: hours(0.5, 24),
  stationMaxHours: hours(0.5, 24),
  stationMinLeadMinutes: int(0, 24 * 60),
  stationMaxAdvanceDays: int(1, 365),
  stationCancelCutoffHours: hours(0, 168),
  maxStationsPerBooking: int(1, 50),
  venueMinHours: hours(0.5, 24),
  venueMinLeadHours: int(0, 24 * 60),
  venueMaxAdvanceDays: int(1, 365),
  venueCancelCutoffHours: int(0, 24 * 60),
  approvalTimeoutHours: int(1, 24 * 14),
  venueBufferMinutes: int(0, 240),
  graceMinutes: int(0, 240),
  maxUpcomingPerCustomer: int(1, 20),
  noShowLimit: int(1, 50),
});
export type SettingsForm = z.infer<typeof settingsFormSchema>;

export type EditableSettings = Pick<
  BookingSettings,
  | "openingHours"
  | "station"
  | "venue"
  | "graceMinutes"
  | "maxUpcomingPerCustomer"
  | "noShowLimit"
> & { venueName: string; address: string };

export interface SettingsIssue {
  /** Form field the issue belongs to, e.g. "days.5" or "stationMaxHours". */
  field: string;
  /** Message key under admin.settings.issues. */
  code: string;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Validates the form beyond field ranges and converts it. Issues come back as keys to translate. */
export function toStoredSettings(
  form: SettingsForm,
  slotMinutes: number,
):
  | { ok: true; settings: EditableSettings }
  | { ok: false; issues: SettingsIssue[] } {
  const issues: SettingsIssue[] = [];
  const onSlot = (minutes: number) => minutes % slotMinutes === 0;

  const openingHours: OpeningHours[] = [];
  form.days.forEach((day, weekday) => {
    if (day.closed) return;
    if (!TIME.test(day.open) || !TIME.test(day.close)) {
      issues.push({ field: `days.${weekday}`, code: "time" });
      return;
    }
    if (!onSlot(minutesOf(day.open)) || !onSlot(minutesOf(day.close))) {
      issues.push({ field: `days.${weekday}`, code: "timeOnSlot" });
      return;
    }
    openingHours.push({ weekday, open: day.open, close: day.close });
  });
  if (
    openingHours.length === 0 &&
    !issues.some((i) => i.field.startsWith("days."))
  ) {
    issues.push({ field: "days", code: "noOpenDay" });
  }

  // A business day may run past midnight, but not into the next day's opening.
  for (const h of openingHours) {
    const next = openingHours.find((o) => o.weekday === (h.weekday + 1) % 7);
    if (!next) continue;
    const open = minutesOf(h.open);
    const close =
      minutesOf(h.close) <= open
        ? minutesOf(h.close) + DAY_MINUTES
        : minutesOf(h.close);
    if (close > minutesOf(next.open) + DAY_MINUTES) {
      issues.push({ field: `days.${h.weekday}`, code: "overlap" });
    }
  }

  const stationMin = Math.round(form.stationMinHours * 60);
  const stationMax = Math.round(form.stationMaxHours * 60);
  const venueMin = Math.round(form.venueMinHours * 60);
  const cancelCutoff = Math.round(form.stationCancelCutoffHours * 60);
  for (const [field, minutes] of [
    ["stationMinHours", stationMin],
    ["stationMaxHours", stationMax],
    ["venueMinHours", venueMin],
    ["venueBufferMinutes", form.venueBufferMinutes],
  ] as const) {
    if (!onSlot(minutes)) issues.push({ field, code: "durationOnSlot" });
  }
  if (stationMin > stationMax)
    issues.push({ field: "stationMaxHours", code: "maxBelowMin" });

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    settings: {
      venueName: form.venueName,
      address: form.address,
      openingHours,
      station: {
        minMinutes: stationMin,
        maxMinutes: stationMax,
        minLeadMinutes: form.stationMinLeadMinutes,
        maxAdvanceDays: form.stationMaxAdvanceDays,
        cancelCutoffMinutes: cancelCutoff,
        maxStationsPerBooking: form.maxStationsPerBooking,
      },
      venue: {
        minMinutes: venueMin,
        minLeadHours: form.venueMinLeadHours,
        maxAdvanceDays: form.venueMaxAdvanceDays,
        cancelCutoffHours: form.venueCancelCutoffHours,
        approvalTimeoutHours: form.approvalTimeoutHours,
        bufferMinutes: form.venueBufferMinutes,
      },
      graceMinutes: form.graceMinutes,
      maxUpcomingPerCustomer: form.maxUpcomingPerCustomer,
      noShowLimit: form.noShowLimit,
    },
  };
}

/** The current settings as form values, to prefill the page. */
export function toSettingsForm(s: EditableSettings): SettingsForm {
  return {
    venueName: s.venueName,
    address: s.address,
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
      const h = s.openingHours.find((o) => o.weekday === weekday);
      return h
        ? { closed: false, open: h.open, close: h.close }
        : { closed: true, open: "16:00", close: "04:00" };
    }),
    stationMinHours: s.station.minMinutes / 60,
    stationMaxHours: s.station.maxMinutes / 60,
    stationMinLeadMinutes: s.station.minLeadMinutes,
    stationMaxAdvanceDays: s.station.maxAdvanceDays,
    stationCancelCutoffHours: s.station.cancelCutoffMinutes / 60,
    maxStationsPerBooking: s.station.maxStationsPerBooking,
    venueMinHours: s.venue.minMinutes / 60,
    venueMinLeadHours: s.venue.minLeadHours,
    venueMaxAdvanceDays: s.venue.maxAdvanceDays,
    venueCancelCutoffHours: s.venue.cancelCutoffHours,
    approvalTimeoutHours: s.venue.approvalTimeoutHours,
    venueBufferMinutes: s.venue.bufferMinutes,
    graceMinutes: s.graceMinutes,
    maxUpcomingPerCustomer: s.maxUpcomingPerCustomer,
    noShowLimit: s.noShowLimit,
  };
}
