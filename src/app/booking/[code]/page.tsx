import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currencyLabel } from "@/server/email/compose";
import { getPublicSettings, loadManagedBooking } from "@/server/public-booking";
import { getCurrentUser } from "@/server/session";
import { CancelForm } from "./cancel-form";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function ManageBookingPage({ params, searchParams }: Props) {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-6 sm:py-10">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label={t("app.name")}>
          <Image src="/brand/emblem.png" alt={t("app.logoAlt")} width={40} height={40} className="rounded-xl ring-1 ring-border" />
        </Link>
        <h1 className="text-2xl font-semibold">{t("manage.title")}</h1>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t("manage.loading")}</p>}>
        <ManageContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function ManageContent({ params, searchParams }: Props) {
  await connection(); // reads the clock and the session: request time only
  const [{ code }, query, user, t] = await Promise.all([
    params,
    searchParams,
    getCurrentUser(),
    getTranslations("manage"),
  ]);
  const token = first(query.t);
  const [booking, settings] = await Promise.all([
    loadManagedBooking(decodeURIComponent(code), token, user),
    getPublicSettings(),
  ]);

  if (!booking || !settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("notFoundLead")}</p>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild>
            <Link href={`/login?next=/booking/${encodeURIComponent(code)}`}>{t("login")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">{t("home")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const fmt = (d: Date, pattern: string) => formatInTimeZone(d, settings.timezone, pattern, { locale: fr });
  const active = booking.status === "confirmed" || booking.status === "pending_approval";
  const canCancel =
    (active || booking.status === "checked_in") &&
    (booking.access === "staff" || (active && new Date() <= booking.cancelUntil));

  const rows = [
    { label: t("date"), value: fmt(booking.start, "EEEE d MMMM yyyy") },
    { label: t("time"), value: `${fmt(booking.start, "HH:mm")} – ${fmt(booking.end, "HH:mm")}` },
    { label: t("stations"), value: booking.stationNames.join(", ") },
    ...(booking.partySize ? [{ label: t("partySize"), value: t("partySizeValue", { count: booking.partySize }) }] : []),
    booking.quotedPrice !== undefined
      ? {
          label: t("quoted"),
          value: t("priceValue", { amount: booking.quotedPrice, currency: currencyLabel(settings.currency) }),
        }
      : {
          label: t("price"),
          value:
            booking.priceEstimate > 0
              ? t("priceValue", { amount: booking.priceEstimate, currency: currencyLabel(settings.currency) })
              : t("priceOnSite"),
        },
    ...(settings.address ? [{ label: t("address"), value: settings.address }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      {booking.status === "pending_approval" ? (
        <p role="status" className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t("pendingNotice")}
        </p>
      ) : null}
      {first(query.new) && booking.status === "confirmed" ? (
        <p role="status" className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          {t("justBooked")}
        </p>
      ) : null}
      {booking.status === "cancelled" ? (
        <p role="status" className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t("cancelled")}
        </p>
      ) : null}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{t("codeLabel")}</span>
            <span
              data-testid="booking-status"
              className={
                active
                  ? "rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary"
                  : "rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"
              }
            >
              {t(`status.${booking.status}`)}
            </span>
          </div>
          <p data-testid="booking-code" className="font-mono text-3xl font-bold tracking-[0.2em]">
            {booking.code}
          </p>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border border-t border-border">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="capitalize-first">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {active ? <p className="text-sm text-muted-foreground">{t("arrival", { minutes: settings.graceMinutes })}</p> : null}

      {canCancel ? (
        <div className="flex flex-col gap-2">
          <CancelForm code={booking.code} token={token} />
          {booking.access !== "staff" ? (
            <p className="text-xs text-muted-foreground">
              {t("cancelUntil", { date: fmt(booking.cancelUntil, "EEEE d MMMM 'à' HH:mm") })}
            </p>
          ) : null}
        </div>
      ) : active ? (
        <p className="text-sm text-muted-foreground">{t("cancelClosed")}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href="/book">{t("bookAgain")}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </div>
  );
}
