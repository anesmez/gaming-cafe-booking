import { z } from "zod";

/**
 * Environment validation.
 *
 * Variables are required from the milestone that first uses them:
 * MONGODB_URI and OWNER_EMAIL now, the rest become required in later
 * milestones (auth, email, cron). Tighten the schema when that happens.
 */
export const envSchema = z.object({
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
  OWNER_EMAIL: z.email(),
  APP_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Treat empty strings (`KEY=` in a .env file) as unset. */
function dropEmpty(source: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(dropEmpty(source));
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Lazily validated so `next build` works without secrets. Call this at the
 * point of use (request time, scripts), never at module top level.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
