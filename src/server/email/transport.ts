import { appendFile } from "node:fs/promises";
import { Resend } from "resend";

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

/** Sends one email. Throws when it could not be handed to the provider. */
export type EmailTransport = (message: EmailMessage) => Promise<{ providerId?: string }>;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured: set RESEND_API_KEY and EMAIL_FROM.");
    this.name = "EmailNotConfiguredError";
  }
}

function resendTransport(apiKey: string, from: string): EmailTransport {
  const resend = new Resend(apiKey);
  return async (message) => {
    const { data, error } = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "utf8"),
        contentType: a.contentType,
      })),
    });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
    return { providerId: data?.id };
  };
}

/** Local development without a provider: print the email to the server console. */
const consoleTransport: EmailTransport = async (message) => {
  console.info(`\n[email:dev] to ${message.to}\n[email:dev] ${message.subject}\n${message.text}\n`);
  return {};
};

/** End-to-end tests only: append each email as one JSON line to a file. */
function fileTransport(path: string): EmailTransport {
  return async (message) => {
    await appendFile(path, JSON.stringify({ ...message, attachments: undefined }) + "\n", "utf8");
    return {};
  };
}

/**
 * EMAIL_OUTBOX_FILE (tests, never on Vercel), then Resend when it is configured. Without it, emails are printed in development
 * and refused in production: a login code must never be written to production logs.
 */
export function defaultTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  if (env.EMAIL_OUTBOX_FILE && !env.VERCEL) return fileTransport(env.EMAIL_OUTBOX_FILE);
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    return resendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  if (env.NODE_ENV !== "production") return consoleTransport;
  return async () => {
    throw new EmailNotConfiguredError();
  };
}
