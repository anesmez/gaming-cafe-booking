import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

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
