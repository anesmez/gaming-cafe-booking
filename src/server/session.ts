import { headers } from "next/headers";
import { toRole, type Role } from "@/lib/auth/roles";
import { EnvError } from "@/lib/env";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * The logged-in user for the current request, or null.
 *
 * This reads the request, so under Cache Components it must be called from a
 * component inside a <Suspense> boundary (or from a server action or route
 * handler), never at the top of a layout.
 *
 * Every admin page and action checks the role on the server with this; the
 * client is never trusted with it.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const requestHeaders = await headers();

  let auth;
  try {
    auth = await getAuth();
  } catch (error) {
    if (error instanceof EnvError) {
      // Not configured yet (no database or secret): nobody can be logged in.
      console.error(error.message);
      return null;
    }
    throw error;
  }

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const user = session.user as typeof session.user & { role?: unknown };
  return { id: user.id, email: user.email, name: user.name, role: toRole(user.role) };
}
