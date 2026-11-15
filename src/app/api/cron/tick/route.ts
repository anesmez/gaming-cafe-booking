import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { runTick } from "@/server/jobs";

/**
 * Called by the schedulers (GitHub Actions every 30 minutes, Vercel Cron once
 * a day) with `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  await connection();

  const secret = getEnv().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorised(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "FORBIDDEN" }, { status: 401 });
  }

  const report = await runTick();
  return Response.json(report, { status: report.errors.length > 0 ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

function authorised(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
