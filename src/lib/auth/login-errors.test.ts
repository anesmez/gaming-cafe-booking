import { describe, expect, it } from "vitest";
import { AUTH_ERRORS, classifySendError, classifyVerifyError } from "./login-errors";

/** The shape the auth library throws: an error with a status and a body. */
const apiError = (code: string, message: string) => Object.assign(new Error(message), { body: { code, message } });

describe("classifyVerifyError", () => {
  it("recognises the auth library's code errors", () => {
    expect(classifyVerifyError(apiError("INVALID_OTP", "Invalid OTP"))).toBe("wrongCode");
    expect(classifyVerifyError(apiError("OTP_EXPIRED", "OTP expired"))).toBe("expiredCode");
    expect(classifyVerifyError(apiError("TOO_MANY_ATTEMPTS", "Too many attempts"))).toBe("tooManyAttempts");
  });

  it("works from the message alone or the code alone", () => {
    expect(classifyVerifyError(new Error("Invalid OTP"))).toBe("wrongCode");
    expect(classifyVerifyError({ body: { code: "OTP_EXPIRED" } })).toBe("expiredCode");
  });

  it("treats anything else as the service being unavailable", () => {
    expect(classifyVerifyError(new Error("connect ECONNREFUSED"))).toBe("unavailable");
    expect(classifyVerifyError(null)).toBe("unavailable");
    expect(classifyVerifyError("nope")).toBe("unavailable");
  });
});

describe("classifySendError", () => {
  it("tells the per-address limit apart from a delivery failure", () => {
    expect(classifySendError(apiError("TOO_MANY_REQUESTS", AUTH_ERRORS.rateLimited))).toBe("tooManyCodes");
    expect(classifySendError(apiError("SERVICE_UNAVAILABLE", AUTH_ERRORS.sendFailed))).toBe("unavailable");
    expect(classifySendError(new Error("boom"))).toBe("unavailable");
  });
});
