import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { addDays, isLocalDate } from "@/lib/booking";
import { cn } from "@/lib/utils";
import { getDaySchedule } from "@/server/booking-service";
import { currentBusinessDate, requireStaffUser } from "@/server/staff";
import { BookingList } from "../_components/day-list";
import { DayGrid } from "../_components/day-grid";
import { Forbidden } from "../_components/gate";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const t = useTranslations("admin");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

async function Calendar({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const query = await searchParams;
  const requested = typeof query.date === "string" && isLocalDate(query.date) ? query.date : null;
  const gate = await requireStaffUser(`/admin/calendar${requested ? `?date=${requested}` : ""}`);
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const t = await getTranslations("admin");
  const now = new Date();
  const today = await currentBusinessDate(now);
  const date = requested ?? today;

  // Week overview: the 7 days starting at the chosen one, with booked hours.
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(date, i));
  const [schedule, ...week] = await Promise.all([getDaySchedule(date), ...weekDates.map((d) => getDaySchedule(d))]);
  const bookedHours = (s: typeof schedule) =>
    (s.rows.reduce((sum, r) => sum + r.slots.filter(Boolean).length, 0) * s.slotMinutes) / 60;
  const label = (d: string, pattern: string) =>
    formatInTimeZone(new Date(`${d}T12:00:00Z`), "UTC", pattern, { locale: fr });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("calendarTitle")}</h1>
          <p className="capitalize-first text-sm text-muted-foreground">{label(date, "EEEE d MMMM yyyy")}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/calendar?date=${addDays(date, -1)}`}>{t("prevDay")}</Link>
          </Button>
          {date !== today ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/calendar">{t("goToday")}</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/calendar?date=${addDays(date, 1)}`}>{t("nextDay")}</Link>
          </Button>
        </div>
      </div>

      <nav aria-label={t("week")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {weekDates.map((d, i) => (
          <Link
            key={d}
            href={`/admin/calendar?date=${d}`}
            className={cn(
              "flex min-w-24 shrink-0 flex-col rounded-md border px-3 py-2 text-sm",
              d === date ? "border-primary bg-primary/15" : "border-border bg-card hover:bg-muted",
            )}
          >
            <span className="capitalize-first font-medium">{label(d, "EEE d MMM")}</span>
            <span className="text-xs text-muted-foreground">
              {week[i].open ? t("weekHours", { hours: bookedHours(week[i]) }) : t("closedDay")}
            </span>
          </Link>
        ))}
      </nav>

      <DayGrid schedule={schedule} now={now} />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("dayList")}</h2>
        <BookingList bookings={schedule.dayList} timezone={schedule.timezone} empty={t("dayListEmpty")} />
      </section>
    </>
  );
}
