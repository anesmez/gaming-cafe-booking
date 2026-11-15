/**
 * Seeds settings, stations and the owner account.
 * Usage: pnpm seed   (reads .env.local if present)
 */
import { EnvError, getEnv } from "../src/lib/env";
import { connectDb, disconnectDb } from "../src/server/db";
import { seed } from "../src/server/seed";

async function main() {
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
    console.error(error instanceof EnvError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
