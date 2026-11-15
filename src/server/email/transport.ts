import { appendFile } from "node:fs/promises";
import nodemailer from "nodemailer";
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
    super("Email is not configured: set GMAIL_USER and GMAIL_APP_PASSWORD, or RESEND_API_KEY and EMAIL_FROM.");
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

/**
 * Gmail with an app password: no domain needed. The sender is the Gmail
 * address itself; Gmail rewrites any other From. Consumer Gmail allows about
 * 500 recipients a day.
 */
function gmailTransport(user: string, appPassword: string, displayName: string): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: appPassword.replace(/\s+/g, "") },
  });
  return async (message) => {
    const info = await transporter.sendMail({
      from: { name: displayName, address: user },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    if (info.rejected.length > 0) throw new Error(`Gmail rejected ${info.rejected.join(", ")}`);
    return { providerId: info.messageId };
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
 * EMAIL_OUTBOX_FILE (tests, never on Vercel), then Gmail, then Resend. Without it, emails are printed in development
 * and refused in production: a login code must never be written to production logs.
 */
export function defaultTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  if (env.EMAIL_OUTBOX_FILE && !env.VERCEL) return fileTransport(env.EMAIL_OUTBOX_FILE);
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    return gmailTransport(env.GMAIL_USER, env.GMAIL_APP_PASSWORD, env.EMAIL_FROM_NAME || "Respawn Cyber Gaming");
  }
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    return resendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  if (env.NODE_ENV !== "production") return consoleTransport;
  return async () => {
    throw new EmailNotConfiguredError();
  };
}
