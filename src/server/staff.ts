import { redirect } from "next/navigation";
import { hasRole } from "@/lib/auth/roles";
import { localDateOf, resolveBusinessDay } from "@/lib/booking";
import { getPublicSettings } from "./public-booking";
import { getCurrentUser, type SessionUser } from "./session";

/**
 * The staff gate for admin pages and actions. Not logged in → login, then
 * back to `returnTo`. Logged in without staff rights → { allowed: false }.
 */
export async function requireStaffUser(
  returnTo: string,
): Promise<{ allowed: true; user: SessionUser } | { allowed: false; user: SessionUser }> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return hasRole(user.role, "staff") ? { allowed: true, user } : { allowed: false, user };
}

/** The business day that is running now (after midnight: still yesterday's). */
export async function currentBusinessDate(now: Date = new Date()): Promise<string> {
  const settings = await getPublicSettings();
  if (!settings) return now.toISOString().slice(0, 10);
  return resolveBusinessDay(now, settings)?.date ?? localDateOf(now, settings.timezone);
}
