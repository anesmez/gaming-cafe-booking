import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { classifyVerifyError } from "@/lib/auth/login-errors";
import { BookingError } from "@/lib/booking";
import { algiers } from "@/lib/booking/fixtures";
import { createAuth, type Auth } from "./auth";
import { createBooking } from "./booking-service";
import { connectDb, disconnectDb } from "./db";
import { LOGIN_CODES_PER_HOUR, notify } from "./email/notify";
import { requestLoginCode } from "./login";
import type { EmailMessage, EmailTransport } from "./email/transport";
import { Booking } from "./models/booking";
import { EmailLog } from "./models/email-log";
import { Resource } from "./models/resource";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";
import { seed } from "./seed";

/**
 * Login by email code and the email pipeline, against a real MongoDB.
 * Emails go to an in-memory outbox instead of a provider.
 */

const OWNER = "owner@example.com";

let replSet: MongoMemoryReplSet;
let auth: Auth;

const outbox: EmailMessage[] = [];
let failDelivery = false;
/** Clock used by notify() for the per-address limit. */
let notifyNow: Date | undefined;

const transport: EmailTransport = async (message) => {
  if (failDelivery) throw new Error("provider is down");
  outbox.push(message);
  return { providerId: `test-${outbox.length}` };
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-auth-test"));
  await seed(OWNER);

  auth = createAuth(mongoose.connection.db, {
    secret: "test-secret-that-is-at-least-32-characters-long",
    baseURL: "http://localhost:3000",
    nextCookies: false,
    sendLoginCode: (email, code) =>
      notify({ type: "login_code", to: email, code }, { transport, now: notifyNow }),
  });
}, 120_000);

afterEach(async () => {
  outbox.length = 0;
  failDelivery = false;
  notifyNow = undefined;
  await Promise.all([
    EmailLog.deleteMany({}),
    Booking.deleteMany({}),
    SlotLock.deleteMany({}),
    User.deleteMany({ email: { $ne: OWNER } }),
    mongoose.connection.collection("sessions").deleteMany({}),
    mongoose.connection.collection("verifications").deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectDb();
  await replSet?.stop();
});

/** Asks for a code and reads it from the email that was "sent". */
async function requestCode(email: string): Promise<string> {
  const result = await requestLoginCode(auth, email.trim().toLowerCase(), { now: notifyNow });
  if (!result.ok) throw Object.assign(new Error(result.error), { loginError: result.error });
  const message = outbox.findLast((m) => m.to === email.trim().toLowerCase());
  const code = message?.subject.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error(`no code email found for ${email}`);
  return code;
}

async function signIn(email: string, otp: string) {
  const { headers, response } = await auth.api.signInEmailOTP({ body: { email, otp }, returnHeaders: true });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { user: response.user, cookie };
}

async function login(email: string) {
  return signIn(email, await requestCode(email));
}

function sessionFor(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ cookie }) });
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

const wrongCodeFor = (code: string) => (code === "000000" ? "111111" : "000000");

describe("login by email code", () => {
  it("emails a 6-digit code and creates a customer the first time an address logs in", async () => {
    const code = await requestCode("player@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toContain(code);

    const { user, cookie } = await signIn("player@example.com", code);

    expect(Types.ObjectId.isValid(user.id)).toBe(true);
    const stored = await User.findById(user.id).lean();
    expect(stored).toMatchObject({
      email: "player@example.com",
      emailVerified: true,
      role: "customer",
      noShowCount: 0,
      blocked: false,
    });

    const session = await sessionFor(cookie);
    expect(session?.user).toMatchObject({ email: "player@example.com", role: "customer" });
  });

  it("never stores the code in readable form", async () => {
    const code = await requestCode("player@example.com");

    const stored = JSON.stringify([
      await EmailLog.find().lean(),
      await mongoose.connection.collection("verifications").find().toArray(),
    ]);
    expect(stored).not.toContain(code);
    expect(await EmailLog.countDocuments({ to: "player@example.com", template: "login_code", status: "sent" })).toBe(1);
  });

  it("logs the seeded owner in as owner, without creating a second account", async () => {
    const { user, cookie } = await login(OWNER);

    expect((await sessionFor(cookie))?.user).toMatchObject({ email: OWNER, role: "owner" });
    expect(await User.countDocuments({ email: OWNER })).toBe(1);
    expect(String((await User.findOne({ email: OWNER }).lean())?._id)).toBe(user.id);
  });

  it("treats the address as case-insensitive", async () => {
    await login("Player@Example.com");
    await login("player@example.com");
    expect(await User.countDocuments({ email: "player@example.com" })).toBe(1);
  });

  it("rejects a wrong code and still accepts the right one afterwards", async () => {
    const code = await requestCode("player@example.com");

    const error = await caught(signIn("player@example.com", wrongCodeFor(code)));
    expect(classifyVerifyError(error)).toBe("wrongCode");

    expect((await signIn("player@example.com", code)).user.email).toBe("player@example.com");
  });

  it("accepts a code only once", async () => {
    const code = await requestCode("player@example.com");
    await signIn("player@example.com", code);

    expect(classifyVerifyError(await caught(signIn("player@example.com", code)))).not.toBe("unavailable");
  });

  it("burns the code after too many wrong attempts, so guessing cannot continue", async () => {
    const code = await requestCode("player@example.com");
    const wrong = wrongCodeFor(code);

    const reasons: string[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      reasons.push(classifyVerifyError(await caught(signIn("player@example.com", wrong))));
      if (reasons.at(-1) === "tooManyAttempts") break;
    }
    expect(reasons.at(-1)).toBe("tooManyAttempts");
    expect(reasons.length).toBeLessThanOrEqual(6);

    // Even the right code is refused now.
    await caught(signIn("player@example.com", code));
    expect(await mongoose.connection.collection("sessions").countDocuments()).toBe(0);
  });

  it("refuses a code after 10 minutes", async () => {
    const code = await requestCode("player@example.com");

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      const error = await caught(signIn("player@example.com", code));
      expect(classifyVerifyError(error)).toBe("expiredCode");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a request choose its own role", async () => {
    const code = await requestCode("mallory@example.com");
    const { cookie } = await (async () => {
      const { headers, response } = await auth.api.signInEmailOTP({
        body: { email: "mallory@example.com", otp: code, role: "owner" } as never,
        returnHeaders: true,
      });
      return { user: response.user, cookie: headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
    })();
    expect((await User.findOne({ email: "mallory@example.com" }).lean())?.role).toBe("customer");

    // Nor through the profile endpoint once logged in.
    await auth.api
      .updateUser({ body: { name: "Mallory", role: "owner" } as never, headers: new Headers({ cookie }) })
      .catch(() => undefined);
    expect((await User.findOne({ email: "mallory@example.com" }).lean())?.role).toBe("customer");
    expect((await sessionFor(cookie))?.user).toMatchObject({ role: "customer" });
  });

  it("keeps the session for about 90 days and ends it on sign-out", async () => {
    const { cookie } = await login("player@example.com");

    const session = await sessionFor(cookie);
    const days = (new Date(session!.session.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);

    await auth.api.signOut({ headers: new Headers({ cookie }) });
    expect(await sessionFor(cookie)).toBeNull();
  });

  it("sends at most 5 codes per hour to one address, and does not affect other addresses", async () => {
    notifyNow = new Date("2026-12-01T12:00:00Z");
    for (let i = 0; i < LOGIN_CODES_PER_HOUR; i++) await requestCode("player@example.com");

    const error = await caught(requestCode("player@example.com"));
    expect((error as { loginError?: string }).loginError).toBe("tooManyCodes");
    expect(outbox.filter((m) => m.to === "player@example.com")).toHaveLength(5);
    expect(await EmailLog.countDocuments({ to: "player@example.com" })).toBe(5);

    expect(await requestCode("other@example.com")).toMatch(/^\d{6}$/);

    notifyNow = new Date("2026-12-01T13:00:01Z");
    expect(await requestCode("player@example.com")).toMatch(/^\d{6}$/);
  });

  it("reports a delivery failure instead of pretending the code was sent", async () => {
    failDelivery = true;

    const error = await caught(requestCode("player@example.com"));

    expect((error as { loginError?: string }).loginError).toBe("unavailable");
    const row = await EmailLog.findOne({ to: "player@example.com" }).lean();
    expect(row).toMatchObject({ template: "login_code", status: "failed" });
    expect(row?.error).toContain("provider is down");
  });
});

describe("logged-in customers and the booking engine", () => {
  const NOW = algiers("2026-12-01", "12:00");
  const evening = { start: algiers("2026-12-02", "18:00"), end: algiers("2026-12-02", "19:00") };

  function bookAs(userId: string, email: string) {
    return createBooking(
      {
        actor: { role: "customer", userId },
        stations: { mode: "auto", resourceType: "pc" },
        ...evening,
        customer: { userId, name: "Player", phone: "0550000000", email },
      },
      { now: NOW },
    );
  }

  it("books under the account the auth library created", async () => {
    const { user } = await login("player@example.com");

    const { booking } = await bookAs(user.id, "player@example.com");

    expect(String(booking.customer.userId)).toBe(user.id);
    expect(booking.history[0].by).toBe(`customer:${user.id}`);
  });

  it("refuses a booking from an account staff have blocked", async () => {
    const { user } = await login("player@example.com");
    await User.updateOne({ _id: user.id }, { blocked: true });

    const error = await caught(bookAs(user.id, "player@example.com"));

    expect(error).toBeInstanceOf(BookingError);
    expect((error as BookingError).code).toBe("BLOCKED");
  });
});

describe("booking confirmation email", () => {
  const NOW = algiers("2026-12-01", "12:00");

  async function makeBooking(email: string | undefined) {
    const [pc1, pc2] = await Resource.find({ type: "pc" }).sort({ sortOrder: 1 }).limit(2).lean();
    return createBooking(
      {
        actor: { role: "staff" },
        stations: { mode: "explicit", resourceIds: [String(pc1._id), String(pc2._id)] },
        start: algiers("2026-12-02", "18:00"),
        end: algiers("2026-12-02", "20:00"),
        customer: { name: "Yacine", phone: "0550000000", ...(email ? { email } : {}) },
        source: "phone",
      },
      { now: NOW },
    );
  }

  it("sends the code, the time, the stations, a manage link and a calendar file", async () => {
    const { booking, manageToken } = await makeBooking("yacine@example.com");

    const result = await notify({ type: "booking_confirmed", booking, manageToken }, { transport, now: NOW });

    expect(result).toEqual({ status: "sent" });
    expect(outbox).toHaveLength(1);
    const [email] = outbox;
    expect(email.to).toBe("yacine@example.com");
    expect(email.subject).toContain(booking.code);
    expect(email.text).toContain("Bonjour Yacine");
    expect(email.text).toContain("mercredi 2 décembre 2026");
    expect(email.text).toContain("18:00 – 20:00");
    expect(email.text).toContain("PC 01, PC 02");
    expect(email.text).toContain("Respawn Cyber Gaming");
    expect(email.html).toContain(
      `href="http://localhost:3000/booking/${booking.code}?t=${encodeURIComponent(manageToken)}"`,
    );
    expect(email.attachments?.[0].content).toContain("DTSTART:20261202T170000Z");

    expect(await EmailLog.findOne({ bookingId: booking._id }).lean()).toMatchObject({
      to: "yacine@example.com",
      template: "booking_confirmed",
      status: "sent",
      providerId: "test-1",
    });
  });

  it("sends one confirmation per booking, however often it is asked", async () => {
    const { booking, manageToken } = await makeBooking("yacine@example.com");
    const event = { type: "booking_confirmed" as const, booking, manageToken };

    const results = await Promise.all([
      notify(event, { transport, now: NOW }),
      notify(event, { transport, now: NOW }),
      notify(event, { transport, now: NOW }),
    ]);

    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(results.filter((r) => r.status === "skipped")).toHaveLength(2);
    expect(outbox).toHaveLength(1);
  });

  it("does not throw when delivery fails, records why, and can be retried", async () => {
    const { booking, manageToken } = await makeBooking("yacine@example.com");
    const event = { type: "booking_confirmed" as const, booking, manageToken };

    failDelivery = true;
    const failed = await notify(event, { transport, now: NOW });
    expect(failed.status).toBe("failed");
    expect(failed.reason).toContain("provider is down");
    expect(await EmailLog.findOne({ bookingId: booking._id }).lean()).toMatchObject({ status: "failed" });
    // The booking itself is untouched.
    expect((await Booking.findById(booking._id).lean())?.status).toBe("confirmed");

    failDelivery = false;
    expect((await notify(event, { transport, now: NOW })).status).toBe("sent");
    expect(outbox).toHaveLength(1);
  });

  it("skips a booking that has no email address", async () => {
    const { booking, manageToken } = await makeBooking(undefined);

    const result = await notify({ type: "booking_confirmed", booking, manageToken }, { transport, now: NOW });

    expect(result.status).toBe("skipped");
    expect(outbox).toHaveLength(0);
    expect(await EmailLog.countDocuments()).toBe(0);
  });
});
