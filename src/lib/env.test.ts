import { describe, expect, it } from "vitest";
import { EnvError, getAppUrl, getAuthSecret, parseEnv } from "./env";

const valid = {
  MONGODB_URI: "mongodb+srv://user:pass@cluster.example.mongodb.net/cafe",
  OWNER_EMAIL: "owner@example.com",
};

describe("parseEnv", () => {
  it("accepts the two variables milestone 1 needs", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("treats empty strings as unset, so a blank .env line does not fail optional keys", () => {
    expect(parseEnv({ ...valid, RESEND_API_KEY: "", CRON_SECRET: "" })).toEqual(valid);
  });

  it("names every missing or malformed variable in one error", () => {
    let error: unknown;
    try {
      parseEnv({ MONGODB_URI: "postgres://nope", OWNER_EMAIL: "not-an-email" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    const issues = (error as EnvError).issues.join("\n");
    expect(issues).toContain("MONGODB_URI");
    expect(issues).toContain("OWNER_EMAIL");
  });

  it("rejects a missing MONGODB_URI", () => {
    expect(() => parseEnv({ OWNER_EMAIL: valid.OWNER_EMAIL })).toThrow(EnvError);
  });

  it("rejects secrets that are too short to be real", () => {
    expect(() => parseEnv({ ...valid, CRON_SECRET: "short" })).toThrow(EnvError);
  });
});

describe("getAppUrl", () => {
  it("prefers APP_URL and drops a trailing slash", () => {
    expect(getAppUrl({ APP_URL: "https://respawn.example/", VERCEL_URL: "x.vercel.app" })).toBe(
      "https://respawn.example",
    );
  });

  it("uses the production domain on a Vercel production deployment", () => {
    expect(
      getAppUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "respawn.vercel.app",
        VERCEL_URL: "respawn-abc123.vercel.app",
      }),
    ).toBe("https://respawn.vercel.app");
  });

  it("uses the deployment URL on a preview", () => {
    expect(
      getAppUrl({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "respawn.vercel.app",
        VERCEL_URL: "respawn-abc123.vercel.app",
      }),
    ).toBe("https://respawn-abc123.vercel.app");
  });

  it("falls back to localhost in development", () => {
    expect(getAppUrl({})).toBe("http://localhost:3000");
  });
});

describe("getAuthSecret", () => {
  it("returns a secret of 32 characters or more", () => {
    const secret = "x".repeat(32);
    expect(getAuthSecret({ BETTER_AUTH_SECRET: secret })).toBe(secret);
  });

  it("refuses a missing or short secret", () => {
    expect(() => getAuthSecret({})).toThrow(EnvError);
    expect(() => getAuthSecret({ BETTER_AUTH_SECRET: "too-short" })).toThrow(EnvError);
  });
});
