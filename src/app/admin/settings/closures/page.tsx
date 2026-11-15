import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listStations } from "@/server/admin-config";
import { listClosures } from "@/server/booking-service";
import { getPublicSettings } from "@/server/public-booking";
import { currentBusinessDate, requireStaffUser } from "@/server/staff";
import { createClosureAction, removeClosureAction } from "../../config-actions";
import { Forbidden, OwnerOnly } from "../../_components/gate";
import { Notices } from "../../_components/notices";
import { SettingsNav } from "../../_components/settings-nav";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const select =
  "h-12 w-full rounded-md border border-border bg-background px-3 text-base";

export default function ClosuresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("admin");
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}
    >
      <Closures searchParams={searchParams} />
    </Suspense>
  );
}

async function Closures({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/settings/closures");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;
  if (gate.user.role !== "owner") return <OwnerOnly />;

  const [t, ts, query, settings, closures, stations, today] = await Promise.all(
    [
      getTranslations("admin.closures"),
      getTranslations("admin.settings"),
      searchParams,
      getPublicSettings(),
      listClosures(),
      listStations(),
      currentBusinessDate(),
    ],
  );
  const tz = settings?.timezone ?? "Africa/Algiers";
  const fmt = (d: Date) =>
    formatInTimeZone(d, tz, "EEE d MMM, HH:mm", { locale: fr });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{ts("title")}</h1>
        <SettingsNav current="closures" />
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </div>
      <Notices query={query} doneKey="closures.done" />

      <Card>
        <CardHeader>
          <CardTitle>{t("add")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={createClosureAction}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">{t("from")}</Label>
              <Input
                id="from"
                name="from"
                type="date"
                min={today}
                defaultValue={today}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">{t("to")}</Label>
              <Input id="to" name="to" type="date" min={today} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resourceId">{t("what")}</Label>
              <select
                id="resourceId"
                name="resourceId"
                className={select}
                defaultValue=""
              >
                <option value="">{t("wholeVenue")}</option>
                {stations
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason">{t("reason")}</Label>
              <Input
                id="reason"
                name="reason"
                required
                minLength={2}
                maxLength={80}
                placeholder={t("reasonPlaceholder")}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="lg">
                {t("create")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("upcoming")}</h2>
        {closures.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {closures.map((c) => (
              <li
                key={c.code}
                data-testid="closure"
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.reason} ·{" "}
                    {c.stations ? c.stations.join(", ") : t("wholeVenue")}
                  </p>
                  <p className="text-sm text-muted-foreground capitalize-first">
                    {t("range", { from: fmt(c.start), to: fmt(c.end) })}
                  </p>
                </div>
                <form action={removeClosureAction}>
                  <input type="hidden" name="code" value={c.code} />
                  <Button type="submit" variant="outline">
                    {t("reopen")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
