import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import type { DaySchedule, ScheduleBooking } from "@/server/booking-service";

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-primary/25 border-primary/60 text-foreground",
  checked_in: "bg-accent/35 border-accent text-foreground",
  pending_approval: "bg-muted border-border text-muted-foreground",
};

/**
 * One row per station, one column per slot. A booking is one block spanning
 * its slots; tapping it opens the booking. Tapping a free slot starts a new
 * booking on that station at that time.
 */
export async function DayGrid({ schedule, now }: { schedule: DaySchedule; now: Date }) {
  const t = await getTranslations("admin");
  if (!schedule.open) return <p className="text-sm text-muted-foreground">{t("closedDay")}</p>;

  const time = (d: Date) => formatInTimeZone(d, schedule.timezone, "HH:mm");
  const slotMs = schedule.slotMinutes * 60_000;
  const nowIndex = schedule.slotStarts.findIndex((s) => now >= s && now.getTime() < s.getTime() + slotMs);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(["confirmed", "checked_in", "pending_approval"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-3 rounded-sm border", STATUS_STYLE[s])} aria-hidden />
            {t(`legend.${s}`)}
          </span>
        ))}
      </div>
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border" data-testid="day-grid">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-20 border-b border-border bg-card px-2 py-2 text-left font-semibold" />
              {schedule.slotStarts.map((s, i) => (
                <th
                  key={s.toISOString()}
                  scope="col"
                  className={cn(
                    "min-w-11 border-b border-l border-border px-1 py-2 text-left font-mono font-normal text-muted-foreground",
                    i === nowIndex && "bg-accent/30 text-foreground",
                  )}
                  aria-label={i === nowIndex ? `${time(s)} (${t("now")})` : time(s)}
                >
                  {s.getTime() % (60 * 60_000) === 0 || i === nowIndex ? time(s) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((row) => (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-border bg-card px-2 py-1 text-left font-semibold whitespace-nowrap"
                >
                  {row.name}
                  {!row.bookableOnline ? (
                    <span className="ml-1 font-normal text-muted-foreground">· {t("walkIn")}</span>
                  ) : null}
                </th>
                {cells(row.slots).map((cell) => {
                  const slot = schedule.slotStarts[cell.from];
                  if (!cell.bookingId) {
                    return (
                      <td key={cell.from} className={cn("h-11 border-b border-l border-border p-0", cell.from === nowIndex && "bg-accent/10")}>
                        <Link
                          href={`/admin/bookings/new?date=${schedule.date}&start=${encodeURIComponent(slot.toISOString())}&resource=${row.id}`}
                          className="block h-full w-full hover:bg-muted"
                          aria-label={`${t("free")} ${row.name} ${time(slot)}`}
                        />
                      </td>
                    );
                  }
                  const b: ScheduleBooking | undefined = schedule.bookings[cell.bookingId];
                  return (
                    <td key={cell.from} colSpan={cell.span} className="h-11 border-b border-l border-border p-0.5">
                      <Link
                        href={`/admin/bookings/${b?.code ?? ""}`}
                        className={cn(
                          "flex h-full flex-col justify-center overflow-hidden rounded border px-1.5 leading-tight",
                          STATUS_STYLE[b?.status ?? "confirmed"],
                        )}
                        title={b ? `${b.code} · ${b.customerName} · ${time(b.start)}–${time(b.end)}` : undefined}
                      >
                        <span className="truncate font-semibold">{b?.customerName}</span>
                        <span className="truncate font-mono text-[10px] opacity-80">{b?.code}</span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Groups consecutive slots held by the same booking into one cell. */
function cells(slots: (string | null)[]) {
  const out: { from: number; span: number; bookingId: string | null }[] = [];
  for (let i = 0; i < slots.length; i++) {
    const last = out.at(-1);
    if (slots[i] && last && last.bookingId === slots[i]) last.span++;
    else out.push({ from: i, span: 1, bookingId: slots[i] });
  }
  return out;
}
