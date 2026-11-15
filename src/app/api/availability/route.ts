import { connection } from "next/server";
import { z } from "zod";
import { BookingError } from "@/lib/booking";
import { getAvailability } from "@/server/booking-service";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // "venue": every active station, for a LAN request.
  type: z.enum(["pc", "console", "venue"]),
});

/**
 * Public availability for one business day. Only stations bookable online,
 * and only whether each slot is free: no booking or customer data.
 */
export async function GET(request: Request) {
  await connection();

  const url = new URL(request.url);
  const query = querySchema.safeParse({ date: url.searchParams.get("date"), type: url.searchParams.get("type") });
  if (!query.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });

  try {
    const day =
      query.data.type === "venue"
        ? await getAvailability({ date: query.data.date })
        : await getAvailability({ date: query.data.date, resourceType: query.data.type, onlineOnly: true });
    return Response.json(
      {
        date: day.date,
        open: day.open,
        slotMinutes: day.slotMinutes,
        slotStarts: day.slotStarts.map((d) => d.toISOString()),
        resources: day.resources.map((r) => ({ free: r.free })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof BookingError) return Response.json({ error: error.code }, { status: 400 });
    console.error("availability failed:", error);
    return Response.json({ error: "UNAVAILABLE" }, { status: 503 });
  }
}
