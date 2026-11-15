import { describe, expect, it } from "vitest";
import { defaultTransport, EmailNotConfiguredError } from "./transport";

const message = { to: "player@example.com", subject: "s", html: "<p>h</p>", text: "h" };

describe("defaultTransport", () => {
  it("refuses to send in production when nothing is configured", async () => {
    await expect(defaultTransport({ NODE_ENV: "production" })(message)).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it("ignores the test outbox on Vercel", async () => {
    const transport = defaultTransport({ NODE_ENV: "production", VERCEL: "1", EMAIL_OUTBOX_FILE: "/tmp/x" });
    await expect(transport(message)).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it("does not use Gmail with only half its settings", async () => {
    const transport = defaultTransport({ NODE_ENV: "production", GMAIL_USER: "cafe@gmail.com" });
    await expect(transport(message)).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});
