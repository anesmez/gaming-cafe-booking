import type { LoginError } from "@/lib/auth/login-errors";
import type { Auth } from "./auth";
import { connectDb } from "./db";
import { LOGIN_CODES_PER_HOUR } from "./email/notify";
import { EmailLog } from "./models/email-log";

/**
 * Asks the auth library to email a login code and reports whether it really
 * went out.
 *
 * The library awaits our send callback but swallows its errors (so the public
 * endpoint cannot reveal anything about an address), so a thrown error never
 * reaches us. Instead: check the per-address limit first, then read the email
 * log row that notify() wrote for this request.
 */
export async function requestLoginCode(
  auth: Auth,
  email: string,
  options: { headers?: Headers; now?: Date } = {},
): Promise<{ ok: true } | { ok: false; error: LoginError }> {
  const now = options.now ?? new Date();
  await connectDb();

  const recent = await EmailLog.countDocuments({
    to: email,
    template: "login_code",
    requestedAt: { $gt: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  if (recent >= LOGIN_CODES_PER_HOUR) return { ok: false, error: "tooManyCodes" };

  const latest = () =>
    EmailLog.findOne({ to: email, template: "login_code" }).sort({ _id: -1 }).select({ status: 1 }).lean();
  const before = await latest();

  try {
    await auth.api.sendVerificationOTP({
      body: { email, type: "sign-in" },
      ...(options.headers ? { headers: options.headers } : {}),
    });
  } catch (error) {
    // Validation or the library's own per-IP limit.
    const status = (error as { statusCode?: number }).statusCode;
    return { ok: false, error: status === 429 ? "tooManyCodes" : "unavailable" };
  }

  // notify() writes exactly one row per attempt; a new row means it ran.
  const row = await latest();
  if (!row || String(row._id) === String(before?._id)) return { ok: false, error: "unavailable" };
  if (row.status === "sent") return { ok: true };
  return { ok: false, error: "unavailable" };
}
