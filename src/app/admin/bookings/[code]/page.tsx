import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { BookingError } from "@/lib/booking";
import { getBookingDetails } from "@/server/booking-service";
import { currencyLabel } from "@/server/email/compose";
import { getPublicSettings } from "@/server/public-booking";
import { requireStaffUser } from "@/server/staff";
import { bookingStatusAction } from "../../actions";
import { Forbidden } from "../../_components/gate";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function StaffBookingPage(props: Props) {
  const t = useTranslations("admin");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <StaffBooking {...props} />
    </Suspense>
  );
}

async function StaffBooking({ params, searchParams }: Props) {
  await connection();
  const [{ code: rawCode }, query] = await Promise.all([params, searchParams]);
  const code = decodeURIComponent(rawCode);
  const gate = await requireStaffUser(`/admin/bookings/${encodeURIComponent(code)}`);
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const [t, tm, settings] = await Promise.all([getTranslations("admin"), getTranslations("manage"), getPublicSettings()]);
  const viewerIsOwner = gate.user.role === "owner";

  let b;
  try {
    b = await getBookingDetails(code);
  } catch (error) {
    if (error instanceof BookingError && error.code === "NOT_FOUND") {
      return <p className="text-sm text-muted-foreground">{t("errors.NOT_FOUND")}</p>;
    }
    throw error;
  }

  const tz = settings?.timezone ?? "Africa/Algiers";
  const fmt = (d: Date, p: string) => formatInTimeZone(d, tz, p, { locale: fr });
  const done = typeof query.done === "string" ? query.done : null;
  const error = typeof query.error === "string" ? query.error : null;

  const actions: { key: "checkIn" | "noShow" | "complete" | "cancel"; variant: "default" | "outline" | "secondary" }[] =
    b.type === "block"
      ? []
      : b.status === "confirmed"
      ? [
          { key: "checkIn", variant: "default" },
          { key: "noShow", variant: "secondary" },
          { key: "cancel", variant: "outline" },
        ]
      : b.status === "checked_in"
        ? [
            { key: "complete", variant: "default" },
            { key: "cancel", variant: "outline" },
          ]
        : b.status === "pending_approval"
          ? [{ key: "cancel", variant: "outline" }]
          : [];
  const canMove = b.type === "station" && (b.status === "confirmed" || b.status === "checked_in");

  const who = (by: string) => {
    const role = by.split(":")[0];
    return t.has(`by.${role}`) ? t(`by.${role}`) : role;
  };

  const rows = [
    { label: t("fields.when"), value: `${fmt(b.start, "EEEE d MMMM, HH:mm")} – ${fmt(b.end, "HH:mm")}` },
    { label: t("fields.stations"), value: b.resources.map((r) => r.name).join(", ") },
    { label: t("fields.customer"), value: b.customerName },
    { label: t("fields.phone"), value: b.customerPhone, href: `tel:${b.customerPhone.replace(/\s+/g, "")}` },
    ...(b.customerEmail ? [{ label: t("fields.email"), value: b.customerEmail }] : []),
    { label: t("fields.source"), value: t(`sources.${b.source}`) },
    ...(b.notes ? [{ label: t("fields.notes"), value: b.notes }] : []),
    ...(b.priceEstimate > 0
      ? [{ label: t("fields.price"), value: `${b.priceEstimate} ${currencyLabel(settings?.currency ?? "DZD")}` }]
      : []),
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("detailTitle", { code: b.code })}</h1>
        <span data-testid="booking-status" className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
          {tm(`status.${b.status}`)}
        </span>
      </div>

      {done ? (
        <p role="status" className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          {done === "created" ? t("created") : t.has(`done.${done}`) ? t(`done.${done}`) : null}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.other")}
        </p>
      ) : null}

      <Card>
        <CardContent className="pt-5">
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="capitalize-first min-w-0 break-words">
                  {"href" in row && row.href ? (
                    <a href={row.href} className="underline underline-offset-4">
                      {row.value}
                    </a>
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {b.type === "block" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          <span>{t("closure.badge")}</span>
          {viewerIsOwner ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/settings/closures">{t("closure.manage")}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {b.status === "pending_approval" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          <span>{t("pendingRequest")}</span>
          <Button asChild size="sm">
            <Link href="/admin/requests">{t("answerRequest")}</Link>
          </Button>
        </div>
      ) : null}

      {actions.length > 0 || canMove ? (
        <form action={bookingStatusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="code" value={b.code} />
          {actions.map((a) => (
            <Button key={a.key} type="submit" name="action" value={a.key} variant={a.variant} size="lg">
              {t(`actions.${a.key}`)}
            </Button>
          ))}
          {canMove ? (
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/bookings/${b.code}/move`}>{t("actions.move")}</Link>
            </Button>
          ) : null}
        </form>
      ) : null}
      {b.status === "confirmed" ? (
        <p className="text-xs text-muted-foreground">{t("noShowHint", { minutes: settings?.graceMinutes ?? 15 })}</p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">{t("history")}</h2>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2 text-sm">
            {b.history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="font-mono text-xs">{fmt(h.at, "dd/MM HH:mm")}</span>
                <span className="text-foreground">
                  {h.from
                    ? t("historyEntry", { from: tm(`status.${h.from}`), to: tm(`status.${h.to}`) })
                    : t("historyCreated", { to: tm(`status.${h.to}`) })}
                </span>
                <span>· {who(h.by)}</span>
                {h.note ? <span className="w-full text-xs">{h.note}</span> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Button asChild variant="ghost" className="self-start">
        <Link href="/admin">{t("back")}</Link>
      </Button>
    </div>
  );
}
