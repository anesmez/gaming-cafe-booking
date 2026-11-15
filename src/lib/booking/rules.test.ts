import { describe, expect, it } from "vitest";
import { algiers, testSettings } from "./fixtures";
import {
  assertCancellable,
  assertCustomerMayBook,
  validateStationBooking,
  type StationBookingRequest,
} from "./rules";
import { BookingError, type BookingErrorCode } from "./types";

const settings = testSettings();
const NOW = algiers("2026-12-01", "12:00");

function codeOf(fn: () => void): BookingErrorCode | "OK" {
  try {
    fn();
    return "OK";
  } catch (error) {
    if (error instanceof BookingError) return error.code;
    throw error;
  }
}

function request(overrides: Partial<StationBookingRequest> = {}): StationBookingRequest {
  return {
    start: algiers("2026-12-02", "18:00"),
    end: algiers("2026-12-02", "20:00"),
    stationCount: 1,
    actor: "customer",
    ...overrides,
  };
}

const validate = (overrides: Partial<StationBookingRequest> = {}, now = NOW) =>
  codeOf(() => validateStationBooking(request(overrides), settings, now));

describe("validateStationBooking", () => {
  it("accepts an ordinary evening booking", () => {
    expect(validate()).toBe("OK");
  });

  it("rejects times off the 30-minute grid", () => {
    expect(validate({ start: algiers("2026-12-02", "18:15") })).toBe("INVALID_INPUT");
    expect(validate({ end: algiers("2026-12-02", "19:45") })).toBe("INVALID_INPUT");
  });

  it("rejects invalid dates and station counts", () => {
    expect(validate({ start: new Date("nope") })).toBe("INVALID_INPUT");
    expect(validate({ stationCount: 0 })).toBe("INVALID_INPUT");
    expect(validate({ stationCount: 1.5 })).toBe("INVALID_INPUT");
  });

  it("enforces the 1 to 6 hour duration, including an inverted range", () => {
    expect(validate({ end: algiers("2026-12-02", "18:30") })).toBe("INVALID_DURATION");
    expect(validate({ end: algiers("2026-12-02", "19:00") })).toBe("OK");
    expect(validate({ start: algiers("2026-12-02", "12:00"), end: algiers("2026-12-02", "18:00") })).toBe("OK");
    expect(validate({ start: algiers("2026-12-02", "12:00"), end: algiers("2026-12-02", "18:30") })).toBe(
      "INVALID_DURATION",
    );
    expect(validate({ end: algiers("2026-12-02", "17:00") })).toBe("INVALID_DURATION");
  });

  it("requires 30 minutes of lead time from customers", () => {
    const start = algiers("2026-12-01", "12:30");
    const end = algiers("2026-12-01", "13:30");
    expect(validate({ start, end }, algiers("2026-12-01", "12:00"))).toBe("OK");
    expect(validate({ start, end }, algiers("2026-12-01", "12:01"))).toBe("TOO_SOON");
  });

  it("limits customers to 14 days ahead", () => {
    expect(validate({ start: algiers("2026-12-15", "12:00"), end: algiers("2026-12-15", "13:00") })).toBe("OK");
    expect(validate({ start: algiers("2026-12-15", "12:30"), end: algiers("2026-12-15", "13:30") })).toBe(
      "TOO_FAR",
    );
  });

  it("limits customers to 5 stations per booking", () => {
    expect(validate({ stationCount: 5 })).toBe("OK");
    expect(validate({ stationCount: 6 })).toBe("TOO_MANY_STATIONS");
  });

  it("rejects bookings outside opening hours", () => {
    expect(validate({ start: algiers("2026-12-02", "08:00"), end: algiers("2026-12-02", "10:00") })).toBe(
      "OUTSIDE_HOURS",
    );
    expect(validate({ start: algiers("2026-12-02", "09:30"), end: algiers("2026-12-02", "11:00") })).toBe(
      "OUTSIDE_HOURS",
    );
  });

  it("allows a booking after midnight until closing, and not past it", () => {
    expect(validate({ start: algiers("2026-12-03", "00:00"), end: algiers("2026-12-03", "02:00") })).toBe("OK");
    expect(validate({ start: algiers("2026-12-02", "23:00"), end: algiers("2026-12-03", "01:00") })).toBe("OK");
    expect(validate({ start: algiers("2026-12-03", "01:00"), end: algiers("2026-12-03", "03:00") })).toBe(
      "OUTSIDE_HOURS",
    );
  });

  it("does not let a booking span closing and the next opening", () => {
    const longDay = testSettings({ station: { ...settings.station, maxMinutes: 24 * 60 } });
    const span = request({ start: algiers("2026-12-03", "01:00"), end: algiers("2026-12-03", "11:00") });
    expect(codeOf(() => validateStationBooking(span, longDay, NOW))).toBe("OUTSIDE_HOURS");
  });

  describe("staff", () => {
    it("can seat a walk-in in the slot that is already running", () => {
      const now = algiers("2026-12-01", "12:10");
      const walkIn = { actor: "staff" as const, start: algiers("2026-12-01", "12:00"), end: algiers("2026-12-01", "13:00") };
      expect(validate(walkIn, now)).toBe("OK");
    });

    it("cannot book a slot that has fully passed", () => {
      const now = algiers("2026-12-01", "12:40");
      const past = { actor: "staff" as const, start: algiers("2026-12-01", "12:00"), end: algiers("2026-12-01", "13:00") };
      expect(validate(past, now)).toBe("TOO_SOON");
    });

    it("is not bound by the booking window or the station count", () => {
      expect(
        validate({
          actor: "staff",
          stationCount: 10,
          start: algiers("2027-01-20", "18:00"),
          end: algiers("2027-01-20", "20:00"),
        }),
      ).toBe("OK");
    });

    it("is still bound by opening hours, the slot grid and duration", () => {
      expect(validate({ actor: "staff", start: algiers("2026-12-02", "07:00"), end: algiers("2026-12-02", "09:00") })).toBe(
        "OUTSIDE_HOURS",
      );
      expect(validate({ actor: "staff", start: algiers("2026-12-02", "18:10") })).toBe("INVALID_INPUT");
      expect(validate({ actor: "staff", end: algiers("2026-12-02", "18:30") })).toBe("INVALID_DURATION");
    });
  });
});

describe("assertCustomerMayBook", () => {
  const may = (standing: Parameters<typeof assertCustomerMayBook>[0]) =>
    codeOf(() => assertCustomerMayBook(standing, settings));

  it("allows a customer in good standing", () => {
    expect(may({ blocked: false, noShowCount: 2, upcomingCount: 1 })).toBe("OK");
  });

  it("blocks after the third no-show or a manual block", () => {
    expect(may({ blocked: false, noShowCount: 3, upcomingCount: 0 })).toBe("BLOCKED");
    expect(may({ blocked: true, noShowCount: 0, upcomingCount: 0 })).toBe("BLOCKED");
  });

  it("stops at two upcoming bookings", () => {
    expect(may({ blocked: false, noShowCount: 0, upcomingCount: 2 })).toBe("LIMIT_REACHED");
  });
});

describe("assertCancellable", () => {
  const booking = {
    type: "station" as const,
    status: "confirmed" as const,
    start: algiers("2026-12-02", "18:00"),
    end: algiers("2026-12-02", "20:00"),
  };
  const cancel = (actor: "customer" | "staff", now: Date, overrides = {}) =>
    codeOf(() => assertCancellable({ ...booking, ...overrides }, actor, settings, now));

  it("lets a customer cancel up to 2 hours before start", () => {
    expect(cancel("customer", algiers("2026-12-02", "16:00"))).toBe("OK");
    expect(cancel("customer", algiers("2026-12-02", "16:01"))).toBe("CUTOFF_PASSED");
  });

  it("lets staff cancel after the cutoff and during the session", () => {
    expect(cancel("staff", algiers("2026-12-02", "17:30"))).toBe("OK");
    expect(cancel("staff", algiers("2026-12-02", "19:00"), { status: "checked_in" })).toBe("OK");
  });

  it("never lets a customer cancel once checked in", () => {
    expect(cancel("customer", algiers("2026-12-01", "12:00"), { status: "checked_in" })).toBe("CUTOFF_PASSED");
  });

  it("uses the 48-hour cutoff for LAN bookings", () => {
    const lan = { type: "venue" as const, status: "pending_approval" as const };
    expect(cancel("customer", algiers("2026-11-30", "18:00"), lan)).toBe("OK");
    expect(cancel("customer", algiers("2026-11-30", "18:30"), lan)).toBe("CUTOFF_PASSED");
  });

  it("refuses bookings that are over or no longer hold slots", () => {
    expect(cancel("staff", algiers("2026-12-02", "20:00"))).toBe("INVALID_STATE");
    for (const status of ["cancelled", "completed", "no_show", "rejected", "expired"] as const) {
      expect(cancel("staff", algiers("2026-12-01", "12:00"), { status })).toBe("INVALID_STATE");
    }
  });
});
