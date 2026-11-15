import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { AUTH_ERRORS } from "@/lib/auth/login-errors";
import { getAppUrl, getAuthSecret } from "@/lib/env";
import { connectDb } from "./db";
import { LOGIN_CODE_EXPIRES_MINUTES, notify, type NotifyResult } from "./email/notify";

/**
 * Login by one-time email code, no passwords.
 *
 * The auth library stores users in the same `users` collection as the Mongoose
 * model in models/user.ts. `role`, `phone`, `noShowCount` and `blocked` are
 * declared with `input: false`, so no request can set them: a new address
 * always starts as a customer, and only our own server code changes a role.
 */

const NINETY_DAYS = 60 * 60 * 24 * 90;

export interface CreateAuthOptions {
  secret: string;
  baseURL: string;
  /** Delivers the code. Returns how it went; must not throw. */
  sendLoginCode: (email: string, code: string) => Promise<NotifyResult>;
  /**
   * True inside the Next.js app: lets server actions set the session cookie.
   * False in tests and scripts, where there is no request to write cookies to.
   */
  nextCookies: boolean;
}

type Database = Parameters<typeof mongodbAdapter>[0];

export function createAuth(db: unknown, options: CreateAuthOptions) {
  return betterAuth({
    appName: "Respawn Cyber Gaming",
    secret: options.secret,
    baseURL: options.baseURL,
    // No client is passed, so the adapter does not wrap calls in transactions:
    // a retried transaction would run the send-code callback twice.
    // Mongoose bundles its own copy of the MongoDB driver; the handle is the
    // same shape as the one the adapter is typed against.
    database: mongodbAdapter(db as Database),
    user: {
      modelName: "users",
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "customer", input: false },
        phone: { type: "string", required: false, defaultValue: "", input: false },
        noShowCount: { type: "number", required: false, defaultValue: 0, input: false },
        blocked: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: NINETY_DAYS,
      updateAge: 60 * 60 * 24,
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      customRules: {
        // Per IP. Customers on the café's Wi-Fi share one address, so keep
        // these generous; the per-address limit in notify() guards inboxes.
        "/email-otp/send-verification-otp": { window: 60, max: 10 },
        "/sign-in/email-otp": { window: 60, max: 20 },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: LOGIN_CODE_EXPIRES_MINUTES * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are supported." });
          }
          const result = await options.sendLoginCode(email, otp);
          if (result.status === "rate_limited") {
            throw new APIError("TOO_MANY_REQUESTS", { message: AUTH_ERRORS.rateLimited });
          }
          if (result.status !== "sent") {
            throw new APIError("SERVICE_UNAVAILABLE", { message: AUTH_ERRORS.sendFailed });
          }
        },
      }),
      // Must stay last: it writes the cookies the plugins above produce.
      ...(options.nextCookies ? [nextCookies()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let authPromise: Promise<Auth> | undefined;

/**
 * The app's auth instance, created on first use so that `next build` needs no
 * database or secret. Throws EnvError when MONGODB_URI or BETTER_AUTH_SECRET
 * is missing.
 */
export function getAuth(): Promise<Auth> {
  authPromise ??= (async () => {
    const secret = getAuthSecret();
    const mongoose = await connectDb();
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection has no database handle");

    return createAuth(db, {
      secret,
      baseURL: getAppUrl(),
      sendLoginCode: (email, code) => notify({ type: "login_code", to: email, code }),
      nextCookies: true,
    });
  })().catch((error) => {
    authPromise = undefined;
    throw error;
  });
  return authPromise;
}
