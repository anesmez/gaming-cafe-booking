/**
 * Booking codes customers read out at the counter, e.g. "GC-7K2F".
 * The alphabet leaves out 0/O and 1/I/L so a code survives a phone call.
 */

export const BOOKING_CODE_PREFIX = "GC-";
export const BOOKING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const BOOKING_CODE_LENGTH = 4;
export const BOOKING_CODE_RE = new RegExp(
  `^${BOOKING_CODE_PREFIX}[${BOOKING_CODE_ALPHABET}]{${BOOKING_CODE_LENGTH}}$`,
);

/**
 * @param randomInt returns an integer in [0, max). Injected so the caller picks
 * the randomness source (crypto on the server, a fixed sequence in tests).
 */
export function generateBookingCode(randomInt: (max: number) => number): string {
  let code = BOOKING_CODE_PREFIX;
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    code += BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)];
  }
  return code;
}

/** Accepts what people type: lower case, missing dash, stray spaces. */
export function normalizeBookingCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hasPrefix = compact.length > BOOKING_CODE_LENGTH && compact.startsWith("GC");
  return `${BOOKING_CODE_PREFIX}${hasPrefix ? compact.slice(2) : compact}`;
}
