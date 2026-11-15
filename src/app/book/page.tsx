import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bookableDates, durationOptions } from "@/lib/booking";
import { getCustomerProfile, getPublicSettings } from "@/server/public-booking";
import { getCurrentUser } from "@/server/session";
import { BookingForm } from "./booking-form";

export default function BookPage() {
  const t = useTranslations();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-6 sm:py-10">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label={t("app.name")}>
          <Image src="/brand/emblem.png" alt={t("app.logoAlt")} width={40} height={40} className="rounded-xl ring-1 ring-border" />
        </Link>
        <h1 className="text-2xl font-semibold">{t("book.title")}</h1>
      </header>
      {/* Session and availability are known only at request time. */}
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t("book.loading")}</p>}>
        <BookContent />
      </Suspense>
    </main>
  );
}

async function BookContent() {
  await connection(); // reads the clock and the session: request time only
  const t = await getTranslations("book");
  const [user, settings] = await Promise.all([getCurrentUser(), getPublicSettings().catch(() => null)]);

  if (!settings) {
    return <p className="text-sm text-muted-foreground">{t("unavailable")}</p>;
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("loginTitle")}</CardTitle>
          <CardDescription>{t("loginLead")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" className="w-full">
            <Link href="/login?next=/book">{t("loginCta")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const profile = await getCustomerProfile(user.id);

  return (
    <BookingForm
      dates={bookableDates(now, settings)}
      durations={durationOptions(settings.station, settings.slotMinutes)}
      maxStations={settings.station.maxStationsPerBooking}
      slotMinutes={settings.slotMinutes}
      station={{ minLeadMinutes: settings.station.minLeadMinutes, maxAdvanceDays: settings.station.maxAdvanceDays }}
      timezone={settings.timezone}
      nowIso={now.toISOString()}
      defaults={profile}
    />
  );
}
