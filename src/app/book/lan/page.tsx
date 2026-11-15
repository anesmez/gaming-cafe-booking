import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addMinutes, businessDayWindow, localDateOf, minutesBetween, venueDurationOptions } from "@/lib/booking";
import { Resource } from "@/server/models/resource";
import { getCustomerProfile, getPublicSettings } from "@/server/public-booking";
import { getCurrentUser } from "@/server/session";
import { LanForm } from "./lan-form";

export default function LanPage() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-6 sm:py-10">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label={t("app.name")}>
          <Image src="/brand/emblem.png" alt={t("app.logoAlt")} width={40} height={40} className="rounded-xl ring-1 ring-border" />
        </Link>
        <h1 className="text-2xl font-semibold">{t("lan.title")}</h1>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t("book.loading")}</p>}>
        <LanContent />
      </Suspense>
    </main>
  );
}

async function LanContent() {
  await connection();
  const [t, tb] = await Promise.all([getTranslations("lan"), getTranslations("book")]);
  const [user, settings] = await Promise.all([getCurrentUser(), getPublicSettings().catch(() => null)]);
  if (!settings) return <p className="text-sm text-muted-foreground">{tb("unavailable")}</p>;

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tb("loginTitle")}</CardTitle>
          <CardDescription>{tb("loginLead")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" className="w-full">
            <Link href="/login?next=/book/lan">{tb("loginCta")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const { venue } = settings;
  const earliest = localDateOf(addMinutes(now, venue.minLeadHours * 60), settings.timezone);
  const latest = localDateOf(addMinutes(now, venue.maxAdvanceDays * 24 * 60), settings.timezone);
  // The longest opening of the week caps the LAN length.
  const longest = Math.max(
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const date = new Date(Date.UTC(2026, 0, 4 + i)).toISOString().slice(0, 10);
      const w = businessDayWindow(date, settings.openingHours, settings.timezone);
      return w ? minutesBetween(w.open, w.close) : 0;
    }),
  );
  const [profile, pcCount] = await Promise.all([
    getCustomerProfile(user.id),
    Resource.countDocuments({ type: "pc", active: true }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {t("lead", { stations: pcCount, hours: venue.approvalTimeoutHours })}
      </p>
      <LanForm
        minDate={earliest}
        maxDate={latest}
        durations={venueDurationOptions(venue.minMinutes, Math.max(venue.minMinutes, longest), settings.slotMinutes)}
        slotMinutes={settings.slotMinutes}
        bufferMinutes={venue.bufferMinutes}
        venue={{ minLeadHours: venue.minLeadHours, maxAdvanceDays: venue.maxAdvanceDays }}
        timezone={settings.timezone}
        nowIso={now.toISOString()}
        defaults={profile}
      />
      <Link href="/book" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("back")}
      </Link>
    </div>
  );
}
