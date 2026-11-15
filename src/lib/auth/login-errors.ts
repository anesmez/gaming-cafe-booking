/**
 * Maps what the auth library throws to the messages the login form shows.
 * Pure, so the mapping is unit-tested without a database.
 */

export type LoginError =
  | "invalidEmail"
  | "invalidCode"
  | "wrongCode"
  | "expiredCode"
  | "tooManyAttempts"
  | "tooManyCodes"
  | "unavailable";

/** Thrown by our own send-code callback in src/server/auth.ts. */
export const AUTH_ERRORS = {
  rateLimited: "LOGIN_CODE_RATE_LIMITED",
  sendFailed: "LOGIN_CODE_SEND_FAILED",
} as const;

/** Collects every string the error carries: message, body.code, body.message. */
export function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const e = error as { message?: unknown; body?: { code?: unknown; message?: unknown } | null };
  return [e.message, e.body?.code, e.body?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function classifyVerifyError(error: unknown): LoginError {
  const text = errorText(error).toUpperCase().replace(/_/g, " ");
  if (text.includes("TOO MANY ATTEMPTS")) return "tooManyAttempts";
  if (text.includes("OTP EXPIRED")) return "expiredCode";
  if (text.includes("INVALID OTP")) return "wrongCode";
  return "unavailable";
}
