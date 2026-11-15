import { describe, expect, it } from "vitest";
import { algiers } from "./fixtures";
import { buildIcs } from "./ics";

const event = {
  uid: "GC-7K2F",
  start: algiers("2026-12-02", "18:00"),
  end: algiers("2026-12-02", "20:00"),
  summary: "Respawn Cyber Gaming, PC 01",
  now: algiers("2026-12-01", "12:00"),
};

describe("buildIcs", () => {
  it("writes one event with UTC times", () => {
    const ics = buildIcs(event);

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:GC-7K2F@respawn-booking\r\n");
    expect(ics).toContain("DTSTAMP:20261201T110000Z\r\n");
    expect(ics).toContain("DTSTART:20261202T170000Z\r\n"); // 18:00 in Algiers
    expect(ics).toContain("DTEND:20261202T190000Z\r\n");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("uses CRLF line endings only", () => {
    const ics = buildIcs(event);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("escapes commas, semicolons, backslashes and newlines", () => {
    const ics = buildIcs({
      ...event,
      summary: "PC 01, PC 02; équipe",
      description: "Code GC-7K2F\nPaiement sur place",
      location: "Villa n°4, Dar El Beïda",
    });

    expect(ics).toContain("SUMMARY:PC 01\\, PC 02\\; équipe\r\n");
    expect(ics).toContain("DESCRIPTION:Code GC-7K2F\\nPaiement sur place\r\n");
    expect(ics).toContain("LOCATION:Villa n°4\\, Dar El Beïda\r\n");
  });

  it("omits optional fields that are not given", () => {
    const ics = buildIcs(event);
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).not.toContain("LOCATION");
  });

  it("folds long lines at 75 bytes without splitting a character", () => {
    const description = "Réservation confirmée à présenter à l'accueil. ".repeat(5);
    const ics = buildIcs({ ...event, description });

    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfolding gives the original text back.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`DESCRIPTION:${description}`);
  });
});
