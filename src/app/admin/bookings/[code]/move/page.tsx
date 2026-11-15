import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingError, isLocalDate, minutesBetween, resolveBusinessDay } from "@/lib/booking";
import { getBookingDetails, getDaySchedule } from "@/server/booking-service";
import { getPublicSettings } from "@/server/public-booking";
import { requireStaffUser } from "@/server/staff";
import { formProps } from "../../../_components/form-props";
import { Forbidden } from "../../../_components/gate";
import { StaffBookingForm } from "../../../_components/staff-booking-form";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function MoveBookingPage(props: Props) {
  const t = useTranslations("admin");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <MoveBooking {...props} />
    </Suspense>
  );
}

async function MoveBooking({ params, searchParams }: Props) {
  await connection();
  const [{ code: rawCode }, query] = await Promise.all([params, searchParams]);
  const code = decodeURIComponent(rawCode);
  const gate = await requireStaffUser(`/admin/bookings/${encodeURIComponent(code)}/move`);
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const [t, settings] = await Promise.all([getTranslations("admin"), getPublicSettings()]);
  let b;
  try {
    b = await getBookingDetails(code);
  } catch (error) {
    if (error instanceof BookingError && error.code === "NOT_FOUND") {
      return <p className="text-sm text-muted-foreground">{t("errors.NOT_FOUND")}</p>;
    }
    throw error;
  }
  if (!settings) return <p className="text-sm text-muted-foreground">{t("errors.other")}</p>;

  const ownDate = resolveBusinessDay(b.start, settings)?.date ?? b.start.toISOString().slice(0, 10);
  const date = typeof query.date === "string" && isLocalDate(query.date) ? query.date : ownDate;
  const schedule = await getDaySchedule(date);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("moveTitle", { code: b.code })}</h1>
      {schedule.open ? (
        <StaffBookingForm
          key={date}
          mode="move"
          code={b.code}
          {...formProps(schedule, settings, new Date(), b.id)}
          initial={{
            type: b.resources[0]?.type ?? "pc",
            start: date === ownDate ? b.start.toISOString() : undefined,
            durationMinutes: minutesBetween(b.start, b.end),
            resourceIds: b.resources.map((r) => r.id),
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("closedDay")}</p>
      )}
    </>
  );
}
