import { minutesBetween } from "./time";

/**
 * Price shown to the customer before they pay at the café: each station's
 * hourly rate for the booked duration. An estimate, never a charge.
 */
export function estimatePrice(hourlyRates: number[], start: Date, end: Date): number {
  const hours = minutesBetween(start, end) / 60;
  return Math.round(hourlyRates.reduce((sum, rate) => sum + rate, 0) * hours);
}
