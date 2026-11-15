/**
 * Roles from "Users and roles" in docs/SPEC.md. Pure: no database imports.
 * An owner can do everything staff can; staff can do everything a customer can.
 */

export const ROLES = ["customer", "staff", "owner"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { customer: 0, staff: 1, owner: 2 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Anything that is not a known role is treated as a customer, never as more. */
export function toRole(value: unknown): Role {
  return isRole(value) ? value : "customer";
}

export function hasRole(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

/**
 * Where to send someone after login. Only same-site paths are accepted, so a
 * crafted ?next= link cannot bounce a freshly logged-in user to another site.
 */
export function safeRedirectPath(next: unknown, fallback: string): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

export function homePathFor(role: Role): string {
  return hasRole(role, "staff") ? "/admin" : "/";
}
