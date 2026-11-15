"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { classifyVerifyError, type LoginError } from "@/lib/auth/login-errors";
import { homePathFor, safeRedirectPath, toRole } from "@/lib/auth/roles";
import { getAuth } from "@/server/auth";
import { requestLoginCode } from "@/server/login";

export interface LoginState {
  step: "email" | "code";
  email: string;
  error?: LoginError;
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const codeSchema = z.string().trim().regex(/^\d{6}$/);

/**
 * The login form's single action. The pressed button says what to do:
 * "request" emails a code, "verify" checks it, "reset" goes back to the email step.
 */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  switch (formData.get("intent")) {
    case "verify":
      return verifyLoginCode(formData);
    case "reset":
      return { step: "email", email: "" };
    default:
      return sendCode(formData);
  }
}

/** Step 1: email the code. */
async function sendCode(formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { step: "email", email: String(formData.get("email") ?? ""), error: "invalidEmail" };
  }
  const email = parsed.data;

  try {
    const auth = await getAuth();
    const result = await requestLoginCode(auth, email, { headers: await headers() });
    if (!result.ok) return { step: "email", email, error: result.error };
  } catch (error) {
    console.error("login code could not be sent:", error);
    return { step: "email", email, error: "unavailable" };
  }

  return { step: "code", email };
}

/** Step 2: check the code, start the session, go where the user was headed. */
async function verifyLoginCode(formData: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { step: "email", email: "", error: "invalidEmail" };

  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { step: "code", email: email.data, error: "invalidCode" };

  let role;
  try {
    const auth = await getAuth();
    const result = await auth.api.signInEmailOTP({
      body: { email: email.data, otp: code.data },
      headers: await headers(),
    });
    role = toRole((result.user as { role?: unknown }).role);
  } catch (error) {
    const reason = classifyVerifyError(error);
    if (reason === "unavailable") console.error("login failed:", error);
    // A wrong code can be retyped; an expired or burnt one needs a new email.
    return { step: reason === "wrongCode" ? "code" : "email", email: email.data, error: reason };
  }

  // redirect() throws, so it stays outside the try block.
  redirect(safeRedirectPath(formData.get("next"), homePathFor(role)));
}

export async function signOut(): Promise<void> {
  try {
    const auth = await getAuth();
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    console.error("sign-out failed:", error instanceof Error ? error.message : error);
  }
  redirect("/");
}
