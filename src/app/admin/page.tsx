import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDaySchedule } from "@/server/booking-service";
import { currentBusinessDate, requireStaffUser } from "@/server/staff";
import { BookingList } from "./_components/day-list";
import { DayGrid } from "./_components/day-grid";
import { Forbidden } from "./_components/gate";

/** The counter's home: today's grid, then today's list. */
export default function AdminTodayPage() {
  const t = useTranslations("admin");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  await connection();
  const gate = await requireStaffUser("/admin");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const t = await getTranslations("admin");
  const now = new Date();
  const schedule = await getDaySchedule(await currentBusinessDate(now));
  const heading = schedule.opensAt
    ? formatInTimeZone(schedule.opensAt, schedule.timezone, "EEEE d MMMM", { locale: fr })
    : schedule.date;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{t("todayTitle")}</h1>
        <p className="capitalize-first text-sm text-muted-foreground">{heading}</p>
      </div>
      <DayGrid schedule={schedule} now={now} />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("dayList")}</h2>
        <BookingList bookings={schedule.dayList} timezone={schedule.timezone} empty={t("dayListEmpty")} />
      </section>
    </>
  );
}
