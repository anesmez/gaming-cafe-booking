import { Booking } from "./models/booking";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { SlotLock } from "./models/slot-lock";
import { User } from "./models/user";
import { buildDefaultResources, buildDefaultSettings, buildOwner } from "./seed-data";

export interface SeedResult {
  settingsCreated: boolean;
  resourcesCreated: number;
  resourcesTotal: number;
  ownerEmail: string;
}

/**
 * Idempotent: safe to run on every deploy. Existing documents are never
 * overwritten, so changes the owner makes in the dashboard survive a re-seed.
 * The only thing it enforces is that OWNER_EMAIL has the owner role.
 *
 * Expects an open Mongoose connection (see connectDb).
 */
export async function seed(ownerEmail: string): Promise<SeedResult> {
  // Build every index up front, including the unique slot-lock index that
  // prevents double bookings.
  await Promise.all([Settings.init(), Resource.init(), User.init(), Booking.init(), SlotLock.init()]);

  const defaults = buildDefaultSettings();
  const settingsWrite = await Settings.updateOne(
    { key: defaults.key },
    { $setOnInsert: defaults },
    { upsert: true },
  );

  const resourceWrite = await Resource.bulkWrite(
    buildDefaultResources().map((resource) => ({
      updateOne: {
        filter: { name: resource.name },
        update: { $setOnInsert: resource },
        upsert: true,
      },
    })),
  );

  const owner = buildOwner(ownerEmail);
  await User.updateOne(
    { email: owner.email },
    { $set: { role: owner.role }, $setOnInsert: { name: "", phone: "", noShowCount: 0, blocked: false } },
    { upsert: true },
  );

  return {
    settingsCreated: settingsWrite.upsertedCount === 1,
    resourcesCreated: resourceWrite.upsertedCount,
    resourcesTotal: await Resource.countDocuments(),
    ownerEmail: owner.email,
  };
}
