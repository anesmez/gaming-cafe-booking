import { describe, expect, it } from "vitest";
import { MAX_CLOSURE_DAYS, closureSlots, closureWindows } from "./closure";
import { algiers, testSettings } from "./fixtures";
import { addDays } from "./time";

describe("closures", () => {
  it("covers each business day, past midnight included", () => {
    const windows = closureWindows("2026-12-24", "2026-12-25", testSettings());
    expect(windows.map((w) => [w.open, w.close])).toEqual([
      [algiers("2026-12-24", "10:00"), algiers("2026-12-25", "02:00")],
      [algiers("2026-12-25", "10:00"), algiers("2026-12-26", "02:00")],
    ]);
    // 16 hours a day, two 30-minute slots an hour.
    expect(closureSlots(windows, 30)).toHaveLength(64);
  });

  it("skips days the venue is closed anyway", () => {
    const settings = testSettings();
    settings.openingHours = settings.openingHours.filter(
      (h) => h.weekday !== 5,
    ); // no Fridays
    // 2026-12-25 is a Friday.
    expect(
      closureWindows("2026-12-24", "2026-12-26", settings).map((w) => w.date),
    ).toEqual(["2026-12-24", "2026-12-26"]);
  });

  it("refuses reversed, malformed and overly long ranges", () => {
    expect(() =>
      closureWindows("2026-12-25", "2026-12-24", testSettings()),
    ).toThrow(/ends before/);
    expect(() =>
      closureWindows("25/12/2026", "2026-12-26", testSettings()),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      closureWindows(
        "2026-01-01",
        addDays("2026-01-01", MAX_CLOSURE_DAYS),
        testSettings(),
      ),
    ).toThrow(/at most/);
    expect(
      closureWindows(
        "2026-01-01",
        addDays("2026-01-01", MAX_CLOSURE_DAYS - 1),
        testSettings(),
      ),
    ).toHaveLength(MAX_CLOSURE_DAYS);
  });
});
