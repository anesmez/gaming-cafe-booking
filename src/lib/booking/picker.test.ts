import { describe, expect, it } from "vitest";
import { algiers, testSettings } from "./fixtures";
import { bookableDates, bookableStarts, durationOptions, type DayGrid } from "./picker";
import { expandSlots } from "./time";

const settings = testSettings(); // open 10:00 to 02:00 every day

describe("bookableDates", () => {
  it("offers today and the next 14 days", () => {
    const dates = bookableDates(algiers("2026-12-01", "12:00"), settings);
    expect(dates).toHaveLength(15);
    expect(dates[0]).toBe("2026-12-01");
    expect(dates.at(-1)).toBe("2026-12-15");
  });

  it("starts with yesterday's business day after midnight while it is still open", () => {
    expect(bookableDates(algiers("2026-12-02", "01:00"), settings)[0]).toBe("2026-12-01");
  });

  it("skips weekdays the venue is closed", () => {
    const closedFridays = testSettings({ openingHours: settings.openingHours.filter((h) => h.weekday !== 5) });
    const dates = bookableDates(algiers("2026-12-01", "12:00"), closedFridays);
    expect(dates).not.toContain("2026-12-04");
    expect(dates).toHaveLength(13);
  });
});

describe("durationOptions", () => {
  it("lists every duration from 1 to 6 hours in 30-minute steps", () => {
    expect(durationOptions(settings.station, 30)).toEqual([60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]);
  });
});

describe("bookableStarts", () => {
  // Evening of Dec 2: 18:00 to 22:00, eight slots, three stations.
  const slotStarts = expandSlots(algiers("2026-12-02", "18:00"), algiers("2026-12-02", "22:00"), 30);
  const row = (pattern: string) => ({ free: [...pattern].map((c) => c === ".") });
  const options = {
    durationMinutes: 60,
    count: 1,
    slotMinutes: 30,
    now: algiers("2026-12-01", "12:00"),
    station: settings.station,
  };
  const times = (grid: DayGrid, overrides = {}) =>
    bookableStarts(grid, { ...options, ...overrides }).map((o) => o.start.toISOString().slice(11, 16));

  it("offers every start where the session fits before closing", () => {
    const grid = { slotStarts, resources: [row("........")] };
    // 17:00Z is 18:00 in Algiers; the last 1-hour start is 21:00.
    expect(times(grid)).toEqual(["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00"]);
  });

  it("needs the same station free for the whole session", () => {
    // Station A busy 19:00–19:30, station B busy 18:30–19:00.
    const grid = { slotStarts, resources: [row("..x....."), row(".x......")] };
    const starts = bookableStarts(grid, options);
    const at1830 = starts.find((o) => o.start.getTime() === algiers("2026-12-02", "18:30").getTime());
    expect(at1830).toBeUndefined();
    const at1800 = starts.find((o) => o.start.getTime() === algiers("2026-12-02", "18:00").getTime());
    expect(at1800?.freeStations).toBe(1);
  });

  it("requires enough stations for the group", () => {
    const grid = { slotStarts, resources: [row("........"), row("xx......"), row("xx......")] };
    expect(times(grid, { count: 3 })).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00"]);
    expect(times(grid, { count: 4 })).toEqual([]);
  });

  it("returns the end time with each start", () => {
    const grid = { slotStarts, resources: [row("........")] };
    const [first] = bookableStarts(grid, { ...options, durationMinutes: 150 });
    expect(first.end).toEqual(algiers("2026-12-02", "20:30"));
  });

  it("hides starts inside the 30-minute lead time", () => {
    const grid = { slotStarts, resources: [row("........")] };
    expect(times(grid, { now: algiers("2026-12-02", "18:45") })).toEqual(["18:30", "19:00", "19:30", "20:00"]);
  });

  it("hides starts beyond the booking window", () => {
    const grid = { slotStarts, resources: [row("........")] };
    // 14 days after Nov 18 19:00 is Dec 2 19:00.
    expect(times(grid, { now: algiers("2026-11-18", "19:00") })).toEqual(["17:00", "17:30", "18:00"]);
  });

  it("returns nothing for a duration off the slot grid", () => {
    const grid = { slotStarts, resources: [row("........")] };
    expect(bookableStarts(grid, { ...options, durationMinutes: 45 })).toEqual([]);
  });
});
