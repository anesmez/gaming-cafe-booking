import { describe, expect, it } from "vitest";
import { testSettings } from "./fixtures";
import {
  settingsFormSchema,
  toSettingsForm,
  toStoredSettings,
  type SettingsForm,
} from "./settings-form";

const current = {
  ...testSettings(),
  venueName: "Respawn Cyber Gaming",
  address: "Dar El Beïda",
};

function form(overrides: Partial<SettingsForm> = {}): SettingsForm {
  return { ...toSettingsForm(current), ...overrides };
}

describe("settings form", () => {
  it("round-trips the current settings unchanged", () => {
    const result = toStoredSettings(form(), 30);
    expect(result).toEqual({
      ok: true,
      settings: {
        venueName: current.venueName,
        address: current.address,
        openingHours: current.openingHours,
        station: current.station,
        venue: current.venue,
        graceMinutes: 15,
        maxUpcomingPerCustomer: 2,
        noShowLimit: 3,
      },
    });
  });

  it("converts hours to stored minutes", () => {
    const result = toStoredSettings(
      form({
        stationMinHours: 1.5,
        stationMaxHours: 8,
        stationCancelCutoffHours: 3,
      }),
      30,
    );
    expect(result.ok && result.settings.station).toMatchObject({
      minMinutes: 90,
      maxMinutes: 480,
      cancelCutoffMinutes: 180,
    });
  });

  it("leaves a closed day out of the opening hours", () => {
    const days = form().days.map((d, i) =>
      i === 5 ? { ...d, closed: true } : d,
    );
    const result = toStoredSettings(form({ days }), 30);
    expect(
      result.ok && result.settings.openingHours.map((h) => h.weekday),
    ).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it("refuses a week with no open day", () => {
    const days = form().days.map((d) => ({ ...d, closed: true }));
    expect(toStoredSettings(form({ days }), 30)).toEqual({
      ok: false,
      issues: [{ field: "days", code: "noOpenDay" }],
    });
  });

  it("refuses times off the slot grid", () => {
    const days = form().days.map((d, i) =>
      i === 2 ? { ...d, open: "16:15" } : d,
    );
    expect(toStoredSettings(form({ days }), 30)).toMatchObject({
      ok: false,
      issues: [{ field: "days.2", code: "timeOnSlot" }],
    });
  });

  it("refuses a day that runs into the next day's opening", () => {
    // Monday 10:00 → Tuesday 12:00 overlaps Tuesday opening at 10:00.
    const days = form().days.map((d, i) =>
      i === 1 ? { ...d, open: "10:00", close: "12:00" } : d,
    );
    days[1] = { closed: false, open: "14:00", close: "11:00" };
    expect(toStoredSettings(form({ days }), 30)).toMatchObject({
      ok: false,
      issues: [{ field: "days.1", code: "overlap" }],
    });
  });

  it("accepts closing after midnight when the next day opens later", () => {
    const days = form().days.map((d) => ({
      ...d,
      open: "16:00",
      close: "04:00",
    }));
    expect(toStoredSettings(form({ days }), 30).ok).toBe(true);
  });

  it("refuses a maximum below the minimum and durations off the grid", () => {
    const result = toStoredSettings(
      form({ stationMinHours: 3, stationMaxHours: 2, venueBufferMinutes: 20 }),
      30,
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        { field: "venueBufferMinutes", code: "durationOnSlot" },
        { field: "stationMaxHours", code: "maxBelowMin" },
      ],
    });
  });

  it("coerces form strings and rejects out-of-range values", () => {
    const raw = { ...form(), noShowLimit: "4", graceMinutes: "-5" };
    const parsed = settingsFormSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    expect(
      settingsFormSchema.parse({ ...raw, graceMinutes: "10" }).noShowLimit,
    ).toBe(4);
  });
});
