import { connection } from "next/server";
import { connectDb } from "@/server/db";
import { Settings } from "@/server/models/settings";

/**
 * Liveness check for the deployment: can the app reach MongoDB, and has the
 * database been seeded (settings, stations, owner)?
 */
export async function GET() {
  await connection(); // always run at request time, never prerender

  try {
    const mongoose = await connectDb();
    await mongoose.connection.db?.admin().ping();
    const seeded = (await Settings.exists({ key: "default" })) !== null;
    return Response.json({ ok: seeded, db: "up", seeded }, { status: seeded ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, db: "down", seeded: false }, { status: 503 });
  }
}
