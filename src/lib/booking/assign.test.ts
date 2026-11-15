import { describe, expect, it } from "vitest";
import { pickStations, type StationCandidate } from "./assign";
import { BOOKING_CODE_RE, generateBookingCode, normalizeBookingCode } from "./code";
import { algiers } from "./fixtures";
import { estimatePrice } from "./price";

/** Builds a floor from a string: "." is free, "x" is taken. Ids are 1-based positions. */
function floor(layout: string): StationCandidate<number>[] {
  return [...layout].map((c, i) => ({ id: i + 1, sortOrder: i + 1, free: c === "." }));
}

describe("pickStations", () => {
  it("gives a single player the first free station on an empty floor", () => {
    expect(pickStations(floor("....."), 1)).toEqual([1]);
  });

  it("seats a group side by side", () => {
    expect(pickStations(floor("x...x"), 3)).toEqual([2, 3, 4]);
  });

  it("uses the smallest gap that fits and keeps the big run for a bigger group", () => {
    // Free runs: [1..4] and [6,7]. Two players go to 6 and 7.
    expect(pickStations(floor("....x.."), 2)).toEqual([6, 7]);
    // A single player takes the lone seat, not a seat from the pair.
    expect(pickStations(floor("..x.x"), 1)).toEqual([4]);
  });

  it("skips a run that is too short", () => {
    expect(pickStations(floor("..x..."), 3)).toEqual([4, 5, 6]);
  });

  it("splits the group as tightly as possible when no run fits", () => {
    // Free: 1, 4, 5, 7. Three seats: {4,5,7} spans 3, {1,4,5} spans 4.
    expect(pickStations(floor(".xx..x."), 3)).toEqual([4, 5, 7]);
  });

  it("returns null when there are not enough free stations", () => {
    expect(pickStations(floor("x.x.x"), 3)).toBeNull();
    expect(pickStations(floor("xxxxx"), 1)).toBeNull();
    expect(pickStations([], 1)).toBeNull();
  });

  it("does not treat stations across a numbering gap as neighbours", () => {
    const stations = [
      { id: "a", sortOrder: 1, free: true },
      { id: "b", sortOrder: 2, free: true },
      { id: "c", sortOrder: 5, free: true },
      { id: "d", sortOrder: 6, free: true },
      { id: "e", sortOrder: 7, free: true },
    ];
    expect(pickStations(stations, 3)).toEqual(["c", "d", "e"]);
  });

  it("does not depend on input order", () => {
    expect(pickStations(floor("x...x").reverse(), 3)).toEqual([2, 3, 4]);
  });

  it("rejects a count below one", () => {
    expect(pickStations(floor("..."), 0)).toBeNull();
  });
});

describe("booking codes", () => {
  it("generates GC- plus four unambiguous characters", () => {
    let i = 0;
    const code = generateBookingCode((max) => (i++ * 7) % max);
    expect(code).toMatch(BOOKING_CODE_RE);
    expect(code).not.toMatch(/[01ILO]/);
  });

  it("normalises what customers type or say", () => {
    expect(normalizeBookingCode("gc-7k2f")).toBe("GC-7K2F");
    expect(normalizeBookingCode(" GC 7K2F ")).toBe("GC-7K2F");
    expect(normalizeBookingCode("7k2f")).toBe("GC-7K2F");
    expect(normalizeBookingCode("gc7k2f")).toBe("GC-7K2F");
  });

  it("keeps a code whose body itself starts with GC", () => {
    expect(normalizeBookingCode("GC2A")).toBe("GC-GC2A");
    expect(normalizeBookingCode("GC-GC2A")).toBe("GC-GC2A");
  });
});

describe("estimatePrice", () => {
  const start = algiers("2026-12-02", "18:00");

  it("multiplies each station's hourly rate by the duration", () => {
    expect(estimatePrice([200, 200, 300], start, algiers("2026-12-02", "19:30"))).toBe(1050);
  });

  it("is zero while prices are not set", () => {
    expect(estimatePrice([0, 0], start, algiers("2026-12-02", "20:00"))).toBe(0);
  });
});
