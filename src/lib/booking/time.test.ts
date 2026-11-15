import { describe, expect, it } from "vitest";
import { algiers, testSettings } from "./fixtures";
import {
  addDays,
  businessDayWindow,
  expandSlots,
  floorToSlot,
  isLocalDate,
  isSlotAligned,
  localDateOf,
  localTimeToUtc,
  resolveBusinessDay,
  weekdayOf,
} from "./time";

const settings = testSettings();
const TZ = settings.timezone;

describe("local dates", () => {
  it("converts venue wall time to UTC", () => {
    expect(localTimeToUtc("2026-12-02", "10:00", TZ).toISOString()).toBe("2026-12-02T09:00:00.000Z");
  });

  it("reads the venue date, not the UTC date, late in the evening", () => {
    // 23:30 UTC on Dec 2 is already 00:30 on Dec 3 in Algiers.
    expect(localDateOf(new Date("2026-12-02T23:30:00Z"), TZ)).toBe("2026-12-03");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the weekday of a date", () => {
    expect(weekdayOf("2026-11-15")).toBe(0); // Sunday
    expect(weekdayOf("2026-12-02")).toBe(3); // Wednesday
  });

  it("rejects malformed dates", () => {
    expect(isLocalDate("2026-12-02")).toBe(true);
    expect(isLocalDate("2026-13-40")).toBe(false);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("02/12/2026")).toBe(false);
  });
});

describe("businessDayWindow", () => {
  it("runs past midnight when close is before open", () => {
    const day = businessDayWindow("2026-12-02", settings.openingHours, TZ);
    expect(day?.open).toEqual(algiers("2026-12-02", "10:00"));
    expect(day?.close).toEqual(algiers("2026-12-03", "02:00"));
  });

  it("closes the same day when close is after open", () => {
    const hours = [{ weekday: 3, open: "09:00", close: "22:00" }];
    const day = businessDayWindow("2026-12-02", hours, TZ);
    expect(day?.close).toEqual(algiers("2026-12-02", "22:00"));
  });

  it("treats a midnight close as the end of the same evening", () => {
    const hours = [{ weekday: 3, open: "10:00", close: "00:00" }];
    const day = businessDayWindow("2026-12-02", hours, TZ);
    expect(day?.close).toEqual(algiers("2026-12-03", "00:00"));
  });

  it("returns null on a weekday with no opening hours", () => {
    const hours = settings.openingHours.filter((h) => h.weekday !== 5); // closed Fridays
    expect(businessDayWindow("2026-12-04", hours, TZ)).toBeNull();
  });
});

describe("resolveBusinessDay", () => {
  it("assigns the small hours to the previous business day", () => {
    const day = resolveBusinessDay(algiers("2026-12-03", "00:30"), settings);
    expect(day?.date).toBe("2026-12-02");
  });

  it("assigns the evening to its own date", () => {
    expect(resolveBusinessDay(algiers("2026-12-02", "21:00"), settings)?.date).toBe("2026-12-02");
  });

  it("includes the opening instant and excludes the closing instant", () => {
    expect(resolveBusinessDay(algiers("2026-12-02", "10:00"), settings)?.date).toBe("2026-12-02");
    expect(resolveBusinessDay(algiers("2026-12-03", "02:00"), settings)).toBeNull();
  });

  it("returns null between closing and opening", () => {
    expect(resolveBusinessDay(algiers("2026-12-02", "05:00"), settings)).toBeNull();
  });

  it("does not leak into a closed day after midnight", () => {
    // Closed Fridays: Thursday still runs until 02:00 on Friday morning, then nothing.
    const closedFriday = testSettings({
      openingHours: settings.openingHours.filter((h) => h.weekday !== 5),
    });
    expect(resolveBusinessDay(algiers("2026-12-04", "01:00"), closedFriday)?.date).toBe("2026-12-03");
    expect(resolveBusinessDay(algiers("2026-12-04", "15:00"), closedFriday)).toBeNull();
    // Saturday 00:30 would belong to Friday, which is closed.
    expect(resolveBusinessDay(algiers("2026-12-05", "00:30"), closedFriday)).toBeNull();
  });
});

describe("slots", () => {
  it("accepts :00 and :30 and nothing else", () => {
    expect(isSlotAligned(algiers("2026-12-02", "18:00"), 30)).toBe(true);
    expect(isSlotAligned(algiers("2026-12-02", "18:30"), 30)).toBe(true);
    expect(isSlotAligned(algiers("2026-12-02", "18:15"), 30)).toBe(false);
    expect(isSlotAligned(new Date("2026-12-02T17:00:01Z"), 30)).toBe(false);
  });

  it("floors an instant to the slot it is in", () => {
    expect(floorToSlot(algiers("2026-12-02", "18:44"), 30)).toEqual(algiers("2026-12-02", "18:30"));
    expect(floorToSlot(algiers("2026-12-02", "18:30"), 30)).toEqual(algiers("2026-12-02", "18:30"));
  });

  it("expands a range into slot starts, end exclusive", () => {
    const slots = expandSlots(algiers("2026-12-02", "18:00"), algiers("2026-12-02", "19:30"), 30);
    expect(slots).toEqual([
      algiers("2026-12-02", "18:00"),
      algiers("2026-12-02", "18:30"),
      algiers("2026-12-02", "19:00"),
    ]);
  });

  it("expands across midnight without a gap", () => {
    const slots = expandSlots(algiers("2026-12-02", "23:00"), algiers("2026-12-03", "01:00"), 30);
    expect(slots).toHaveLength(4);
    expect(slots[2]).toEqual(algiers("2026-12-03", "00:00"));
  });

  it("returns no slots for an empty or inverted range", () => {
    const t = algiers("2026-12-02", "18:00");
    expect(expandSlots(t, t, 30)).toEqual([]);
    expect(expandSlots(algiers("2026-12-02", "19:00"), t, 30)).toEqual([]);
  });
});
