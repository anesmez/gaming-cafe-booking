import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOKING_STATUSES, isLocalDate } from "@/lib/booking";
import { searchBookings } from "@/server/booking-service";
import { getPublicSettings } from "@/server/public-booking";
import { requireStaffUser } from "@/server/staff";
import { BookingList } from "../_components/day-list";
import { Forbidden } from "../_components/gate";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const t = useTranslations("admin");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <Bookings searchParams={searchParams} />
    </Suspense>
  );
}

async function Bookings({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/bookings");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const [t, tm, query, settings] = await Promise.all([
    getTranslations("admin"),
    getTranslations("manage"),
    searchParams,
    getPublicSettings(),
  ]);
  const q = typeof query.q === "string" ? query.q.slice(0, 80) : "";
  const date = typeof query.date === "string" && isLocalDate(query.date) ? query.date : "";
  const status = (BOOKING_STATUSES as readonly string[]).includes(String(query.status))
    ? (query.status as (typeof BOOKING_STATUSES)[number])
    : undefined;

  const results = await searchBookings({ q, ...(date ? { date } : {}), ...(status ? { status } : {}) });

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("searchTitle")}</h1>
      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" role="search">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q" className="sr-only">
            {t("searchPlaceholder")}
          </Label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">{t("searchDate")}</Label>
          <Input id="date" name="date" type="date" defaultValue={date} className="sm:w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">{t("searchStatus")}</Label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-12 rounded-md border border-border bg-background px-3 text-base"
          >
            <option value="">{t("anyStatus")}</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tm(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="lg">
          {t("search")}
        </Button>
      </form>
      <BookingList
        bookings={results}
        timezone={settings?.timezone ?? "Africa/Algiers"}
        showDate
        empty={t("noResults")}
      />
    </>
  );
}
