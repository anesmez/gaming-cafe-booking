/**
 * Seeds settings, stations and the owner account. Idempotent.
 *
 *   pnpm seed                      reads .env.local, fails loudly on any problem
 *   tsx scripts/seed.ts --if-configured
 *                                  used by `pnpm build`: seeds when MONGODB_URI is
 *                                  set (Vercel), skips otherwise (CI, local), and
 *                                  never fails the build. /api/health reports
 *                                  whether the database ended up seeded.
 */
import { EnvError, getEnv } from "../src/lib/env";
import { connectDb, disconnectDb } from "../src/server/db";
import { seed } from "../src/server/seed";

const lenient = process.argv.includes("--if-configured");

async function main() {
  if (lenient && !process.env.MONGODB_URI) {
    console.log("seed: MONGODB_URI is not set, skipping.");
    return;
  }

  const env = getEnv();
  await connectDb(env.MONGODB_URI);
  const result = await seed(env.OWNER_EMAIL);

  console.log(
    [
      `Settings: ${result.settingsCreated ? "created" : "already present, left untouched"}`,
      `Stations: ${result.resourcesCreated} created, ${result.resourcesTotal} total`,
      `Owner:    ${result.ownerEmail}`,
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    const message = error instanceof EnvError ? error.message : error;
    if (lenient) {
      console.warn("seed: FAILED, continuing with the build. Check MONGODB_URI and Atlas network access.");
      console.warn(message);
    } else {
      console.error(message);
      process.exitCode = 1;
    }
  })
  .finally(() => disconnectDb());
