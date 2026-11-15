import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { isLocalDate } from "@/lib/booking";
import { getDaySchedule } from "@/server/booking-service";
import { getPublicSettings } from "@/server/public-booking";
import { currentBusinessDate, requireStaffUser } from "@/server/staff";
import { formProps } from "../../_components/form-props";
import { Forbidden } from "../../_components/gate";
import { StaffBookingForm } from "../../_components/staff-booking-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A booking taken by phone, WhatsApp or at the counter. */
export default function NewBookingPage({ searchParams }: { searchParams: SearchParams }) {
  const t = useTranslations("admin");
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("newTitle")}</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
        <NewBooking searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewBooking({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/bookings/new");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const [query, settings, t] = await Promise.all([searchParams, getPublicSettings(), getTranslations("admin")]);
  if (!settings) return <p className="text-sm text-muted-foreground">{t("errors.other")}</p>;

  const now = new Date();
  const date = typeof query.date === "string" && isLocalDate(query.date) ? query.date : await currentBusinessDate(now);
  const schedule = await getDaySchedule(date);
  if (!schedule.open) return <p className="text-sm text-muted-foreground">{t("closedDay")}</p>;

  const resource = typeof query.resource === "string" ? query.resource : undefined;
  const preset = schedule.rows.find((r) => r.id === resource);

  return (
    <StaffBookingForm
      key={date}
      mode="create"
      {...formProps(schedule, settings, now)}
      initial={{
        type: preset?.type ?? "pc",
        start: typeof query.start === "string" ? query.start : undefined,
        durationMinutes: 120,
        resourceIds: preset ? [preset.id] : [],
      }}
    />
  );
}
