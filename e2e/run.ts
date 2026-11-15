/**
 * Runs the Playwright tests against the production build with a throwaway
 * database: in-memory MongoDB replica set, seeded, emails written to a file.
 * Requires `pnpm build` first.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PORT = 3100;

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become healthy at ${url}`);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const outbox = join(mkdtempSync(join(tmpdir(), "respawn-e2e-")), "outbox.jsonl");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    MONGODB_URI: replSet.getUri("respawn-e2e"),
    OWNER_EMAIL: "owner@example.com",
    BETTER_AUTH_SECRET: "e2e-secret-that-is-at-least-32-characters-long",
    CRON_SECRET: "e2e-cron-secret-0123456789",
    APP_URL: `http://localhost:${PORT}`,
    EMAIL_OUTBOX_FILE: outbox,
    E2E_OUTBOX_FILE: outbox,
    E2E_BASE_URL: `http://localhost:${PORT}`,
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    VERCEL: "",
  };

  let server: ChildProcess | undefined;
  let code = 1;
  try {
    if ((await run("pnpm", ["exec", "tsx", "scripts/seed.ts"], env)) !== 0) throw new Error("seed failed");

    server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { env, stdio: "inherit" });
    await waitForHealth(`http://localhost:${PORT}/api/health`, 60_000);

    code = await run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], env);
  } finally {
    server?.kill("SIGTERM");
    await replSet.stop();
  }
  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
