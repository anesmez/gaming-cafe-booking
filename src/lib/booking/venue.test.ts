import { describe, expect, it } from "vitest";
import { algiers, testSettings } from "./fixtures";
import { venueDurationOptions, venueStarts } from "./picker";
import { validateVenueRequest } from "./rules";
import { expandSlots } from "./time";
import { BookingError } from "./types";

const settings = testSettings(); // open 10:00–02:00, LAN: 3 h min, 48 h ahead, 30 min buffer
const NOW = algiers("2026-12-01", "12:00");

const code = (fn: () => unknown) => {
  try {
    fn();
    return "OK";
  } catch (e) {
    if (e instanceof BookingError) return e.code;
    throw e;
  }
};

describe("validateVenueRequest", () => {
  it("accepts a 4-hour LAN three days ahead and locks until the end of the cleanup", () => {
    const until = validateVenueRequest({ start: algiers("2026-12-04", "18:00"), end: algiers("2026-12-04", "22:00") }, settings, NOW);
    expect(until).toEqual(algiers("2026-12-04", "22:30"));
  });

  it("cuts the cleanup at closing time", () => {
    const until = validateVenueRequest({ start: algiers("2026-12-04", "22:00"), end: algiers("2026-12-05", "02:00") }, settings, NOW);
    expect(until).toEqual(algiers("2026-12-05", "02:00"));
  });

  it("needs 48 hours notice and at most 60 days", () => {
    expect(code(() => validateVenueRequest({ start: algiers("2026-12-03", "11:30"), end: algiers("2026-12-03", "15:00") }, settings, NOW))).toBe("TOO_SOON");
    expect(code(() => validateVenueRequest({ start: algiers("2026-12-03", "12:00"), end: algiers("2026-12-03", "15:00") }, settings, NOW))).toBe("OK");
    expect(code(() => validateVenueRequest({ start: algiers("2027-02-01", "12:00"), end: algiers("2027-02-01", "15:00") }, settings, NOW))).toBe("TOO_FAR");
  });

  it("needs at least 3 hours, on the slot grid, inside opening hours", () => {
    expect(code(() => validateVenueRequest({ start: algiers("2026-12-04", "18:00"), end: algiers("2026-12-04", "20:30") }, settings, NOW))).toBe("INVALID_DURATION");
    expect(code(() => validateVenueRequest({ start: algiers("2026-12-04", "18:10"), end: algiers("2026-12-04", "22:10") }, settings, NOW))).toBe("INVALID_INPUT");
    expect(code(() => validateVenueRequest({ start: algiers("2026-12-04", "23:00"), end: algiers("2026-12-05", "03:00") }, settings, NOW))).toBe("OUTSIDE_HOURS");
  });
});

describe("venueStarts", () => {
  const slotStarts = expandSlots(algiers("2026-12-04", "18:00"), algiers("2026-12-05", "00:00"), 30); // 12 slots
  const row = (p: string) => ({ free: [...p].map((c) => c === ".") });
  const opts = { durationMinutes: 180, bufferMinutes: 30, slotMinutes: 30, now: NOW, venue: settings.venue };
  const times = (resources: { free: boolean[] }[], o = {}) =>
    venueStarts({ slotStarts, resources }, { ...opts, ...o }).map((s) => s.start.toISOString().slice(11, 16));

  it("needs every station free for the session and its cleanup", () => {
    // Station B busy at 21:30: a 18:00–21:00 LAN fits (cleanup to 21:30), 18:30 does not.
    expect(times([row("............"), row(".......x....")])).toEqual(["17:00"]);
  });

  it("lets the cleanup run up to closing", () => {
    // Starting 21:00 ends at 00:00 = last slot; the cleanup falls off the grid.
    expect(times([row("............")])).toEqual(["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00"]);
  });

  it("offers nothing inside the 48-hour notice", () => {
    expect(times([row("............")], { now: algiers("2026-12-03", "12:00") })).toEqual([]);
  });

  it("lists durations from 3 hours to the longest opening", () => {
    expect(venueDurationOptions(180, 270, 30)).toEqual([180, 210, 240, 270]);
  });
});
