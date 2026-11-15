import type { ResourceType } from "./models/resource";

/**
 * Pure builders for the initial data. Defaults mirror docs/SPEC.md
 * ("Resources and booking rules" and "Data model"). No database access here.
 */

export const PC_COUNT = 10;
/** Half the PCs start bookable online; the rest stay walk-in only. */
export const PCS_BOOKABLE_ONLINE = PC_COUNT / 2;

export interface SeedResource {
  type: ResourceType;
  name: string;
  hourlyRate: number;
  bookableOnline: boolean;
  active: boolean;
  sortOrder: number;
}

export function buildDefaultSettings() {
  return {
    key: "default",
    venueName: "Respawn Cyber Gaming",
    // Address and hours come from the café's Google Maps listing; the owner can
    // change both in Settings (milestone 7).
    address: "Villa n°4, Dar El Beïda 16033, Alger",
    timezone: "Africa/Algiers",
    currency: "DZD",
    locale: "fr",
    slotMinutes: 30,
    // Every day 16:00 to 04:00. close < open = next day.
    openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: "16:00",
      close: "04:00",
    })),
    station: {
      minMinutes: 60,
      maxMinutes: 360,
      minLeadMinutes: 30,
      maxAdvanceDays: 14,
      cancelCutoffMinutes: 120,
      maxStationsPerBooking: 5,
    },
    venue: {
      minMinutes: 180,
      minLeadHours: 48,
      maxAdvanceDays: 60,
      cancelCutoffHours: 48,
      approvalTimeoutHours: 24,
      bufferMinutes: 30,
    },
    graceMinutes: 15,
    maxUpcomingPerCustomer: 2,
    noShowLimit: 3,
  };
}

export function buildDefaultResources(): SeedResource[] {
  const pcs: SeedResource[] = Array.from({ length: PC_COUNT }, (_, i) => ({
    type: "pc",
    name: `PC ${String(i + 1).padStart(2, "0")}`,
    hourlyRate: 0, // prices are an open question for the owner
    bookableOnline: i < PCS_BOOKABLE_ONLINE,
    active: true,
    sortOrder: i + 1,
  }));

  const ps5: SeedResource = {
    type: "console",
    name: "PS5",
    hourlyRate: 0,
    bookableOnline: true,
    active: true,
    sortOrder: PC_COUNT + 1,
  };

  return [...pcs, ps5];
}

export function buildOwner(email: string) {
  return { email: email.trim().toLowerCase(), role: "owner" as const };
}
