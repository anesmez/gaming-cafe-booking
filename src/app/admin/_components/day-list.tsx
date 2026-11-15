import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ScheduleBooking } from "@/server/booking-service";

/** Plain list of bookings, for the day view and search results. */
export async function BookingList({
  bookings,
  timezone,
  showDate = false,
  empty,
}: {
  bookings: ScheduleBooking[];
  timezone: string;
  showDate?: boolean;
  empty: string;
}) {
  const t = await getTranslations();
  if (bookings.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const fmt = (d: Date, p: string) => formatInTimeZone(d, timezone, p);

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {bookings.map((b) => (
        <li key={b.id}>
          <Link href={`/admin/bookings/${b.code}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted">
            <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
              {showDate ? <span className="block">{fmt(b.start, "dd/MM")}</span> : null}
              {fmt(b.start, "HH:mm")}–{fmt(b.end, "HH:mm")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{b.customerName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {b.code} · {b.customerPhone} · {t(`admin.sources.${b.source}`)}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">{t(`manage.status.${b.status}`)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
