import { connection } from "next/server";
import { connectDb } from "@/server/db";

/** Liveness check for the deployment: confirms the app can reach MongoDB. */
export async function GET() {
  await connection(); // always run at request time, never prerender

  try {
    const mongoose = await connectDb();
    await mongoose.connection.db?.admin().ping();
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
