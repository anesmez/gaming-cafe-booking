import { describe, expect, it } from "vitest";
import { buildDefaultResources, buildDefaultSettings, buildOwner } from "./seed-data";

describe("buildDefaultResources", () => {
  const resources = buildDefaultResources();
  const pcs = resources.filter((r) => r.type === "pc");
  const consoles = resources.filter((r) => r.type === "console");

  it("creates 10 PCs and one PS5", () => {
    expect(pcs).toHaveLength(10);
    expect(consoles.map((r) => r.name)).toEqual(["PS5"]);
  });

  it("names PCs PC 01 to PC 10, unique and in display order", () => {
    expect(pcs[0].name).toBe("PC 01");
    expect(pcs[9].name).toBe("PC 10");
    expect(new Set(resources.map((r) => r.name)).size).toBe(resources.length);
    expect(resources.map((r) => r.sortOrder)).toEqual(resources.map((_, i) => i + 1));
  });

  it("keeps half the PCs walk-in only", () => {
    expect(pcs.filter((r) => r.bookableOnline)).toHaveLength(5);
    expect(pcs.slice(0, 5).every((r) => r.bookableOnline)).toBe(true);
    expect(pcs.slice(5).every((r) => !r.bookableOnline)).toBe(true);
  });
});

describe("buildDefaultSettings", () => {
  const settings = buildDefaultSettings();

  it("matches the venue assumptions in the spec", () => {
    expect(settings).toMatchObject({
      venueName: "Respawn Cyber Gaming",
      timezone: "Africa/Algiers",
      currency: "DZD",
      locale: "fr",
      slotMinutes: 30,
      graceMinutes: 15,
      maxUpcomingPerCustomer: 2,
      noShowLimit: 3,
    });
  });

  it("matches the station and LAN rule defaults in the spec", () => {
    expect(settings.station).toEqual({
      minMinutes: 60,
      maxMinutes: 360,
      minLeadMinutes: 30,
      maxAdvanceDays: 14,
      cancelCutoffMinutes: 120,
      maxStationsPerBooking: 5,
    });
    expect(settings.venue).toEqual({
      minMinutes: 180,
      minLeadHours: 48,
      maxAdvanceDays: 60,
      cancelCutoffHours: 48,
      approvalTimeoutHours: 24,
      bufferMinutes: 30,
    });
  });

  it("has opening hours for all seven weekdays, aligned to the slot size", () => {
    expect(settings.openingHours.map((h) => h.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(settings.openingHours.every((h) => h.open === "16:00" && h.close === "04:00")).toBe(true);
    for (const { open, close } of settings.openingHours) {
      for (const time of [open, close]) {
        const minutes = Number(time.slice(3));
        expect(minutes % settings.slotMinutes).toBe(0);
      }
    }
  });
});

describe("buildOwner", () => {
  it("normalises the email so the unique index cannot be bypassed by casing", () => {
    expect(buildOwner("  Owner@Example.COM ")).toEqual({
      email: "owner@example.com",
      role: "owner",
    });
  });
});
