import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDb, disconnectDb } from "./db";
import { Resource } from "./models/resource";
import { Settings } from "./models/settings";
import { User } from "./models/user";
import { seed } from "./seed";

/**
 * Runs against a real MongoDB (in-memory replica set, the same topology as
 * Atlas). Needs to download the MongoDB binary on first run.
 */
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri("cafe-test"));
}, 120_000);

afterAll(async () => {
  await disconnectDb();
  await replSet?.stop();
});

describe("seed", () => {
  it("creates settings, 11 stations and the owner on an empty database", async () => {
    const result = await seed("Owner@Example.com");

    expect(result).toEqual({
      settingsCreated: true,
      resourcesCreated: 11,
      resourcesTotal: 11,
      ownerEmail: "owner@example.com",
    });
    expect(await Settings.countDocuments()).toBe(1);
    expect(await Resource.countDocuments({ type: "pc", bookableOnline: true })).toBe(5);
    expect(await User.findOne({ email: "owner@example.com" }).lean()).toMatchObject({
      role: "owner",
      blocked: false,
      noShowCount: 0,
    });
  });

  it("is idempotent and never overwrites changes made after the first run", async () => {
    await Settings.updateOne({ key: "default" }, { $set: { venueName: "Chez Test" } });
    await Resource.updateOne({ name: "PC 01" }, { $set: { hourlyRate: 250 } });

    const result = await seed("owner@example.com");

    expect(result).toMatchObject({ settingsCreated: false, resourcesCreated: 0, resourcesTotal: 11 });
    expect((await Settings.findOne({ key: "default" }).lean())?.venueName).toBe("Chez Test");
    expect((await Resource.findOne({ name: "PC 01" }).lean())?.hourlyRate).toBe(250);
    expect(await User.countDocuments()).toBe(1);
  });

  it("promotes an existing customer to owner without touching their profile", async () => {
    await User.create({ email: "second@example.com", name: "Sam", noShowCount: 2 });

    await seed("second@example.com");

    expect(await User.findOne({ email: "second@example.com" }).lean()).toMatchObject({
      role: "owner",
      name: "Sam",
      noShowCount: 2,
    });
  });

  it("refuses two stations with the same name at the database level", async () => {
    await expect(
      Resource.create({ type: "pc", name: "PC 01", hourlyRate: 0, bookableOnline: true, sortOrder: 99 }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
