import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listStations } from "@/server/admin-config";
import { currencyLabel } from "@/server/email/compose";
import { getPublicSettings } from "@/server/public-booking";
import { requireStaffUser } from "@/server/staff";
import { cn } from "@/lib/utils";
import { createStationAction, updateStationAction } from "../config-actions";
import { Forbidden, OwnerOnly } from "../_components/gate";
import { Notices } from "../_components/notices";
import { SettingsNav } from "../_components/settings-nav";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const select =
  "h-12 w-full rounded-md border border-border bg-background px-3 text-base";
const check = "flex items-center gap-2 text-sm";

export default function StationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("admin");
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}
    >
      <Stations searchParams={searchParams} />
    </Suspense>
  );
}

async function Stations({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/stations");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;
  if (gate.user.role !== "owner") return <OwnerOnly />;

  const [t, ts, query, stations, settings] = await Promise.all([
    getTranslations("admin.stationsPage"),
    getTranslations("admin.settings"),
    searchParams,
    listStations(),
    getPublicSettings(),
  ]);
  const currency = currencyLabel(settings?.currency ?? "DZD");
  const nextOrder = Math.max(0, ...stations.map((s) => s.sortOrder)) + 1;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{ts("title")}</h1>
        <SettingsNav current="stations" />
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </div>
      <Notices query={query} doneKey="stationsPage.done" />

      <div className="flex flex-col gap-3">
        {stations.map((s) => (
          <Card
            key={s.id}
            data-testid="station"
            className={cn(!s.active && "opacity-70")}
          >
            <CardContent className="pt-5">
              <form
                action={updateStationAction}
                className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_9rem_5rem_auto]"
              >
                <input type="hidden" name="id" value={s.id} />
                <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1">
                  <Label htmlFor={`name-${s.id}`}>
                    {t("name")} ·{" "}
                    <span className="text-muted-foreground">
                      {t(`types.${s.type}`)}
                    </span>
                  </Label>
                  <Input
                    id={`name-${s.id}`}
                    name="name"
                    defaultValue={s.name}
                    maxLength={30}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`rate-${s.id}`}>
                    {t("rate", { currency })}
                  </Label>
                  <Input
                    id={`rate-${s.id}`}
                    name="hourlyRate"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={10}
                    defaultValue={s.hourlyRate}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`order-${s.id}`}>{t("order")}</Label>
                  <Input
                    id={`order-${s.id}`}
                    name="sortOrder"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    defaultValue={s.sortOrder}
                  />
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-span-4">
                  <label className={check}>
                    <input
                      type="checkbox"
                      name="bookableOnline"
                      defaultChecked={s.bookableOnline}
                      className="size-5 accent-primary"
                    />
                    {t("online")}
                  </label>
                  <label className={check}>
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={s.active}
                      className="size-5 accent-primary"
                    />
                    {t("active")}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {t("upcoming", { count: s.upcoming })}
                  </span>
                  <Button
                    type="submit"
                    variant="outline"
                    className="ml-auto"
                    aria-label={`${t("save")} ${s.name}`}
                  >
                    {t("save")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("add")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={createStationAction}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="new-name">{t("name")}</Label>
              <Input
                id="new-name"
                name="name"
                maxLength={30}
                required
                placeholder={`PC ${String(nextOrder).padStart(2, "0")}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-type">{t("type")}</Label>
              <select
                id="new-type"
                name="type"
                className={select}
                defaultValue="pc"
              >
                <option value="pc">{t("types.pc")}</option>
                <option value="console">{t("types.console")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-rate">{t("rate", { currency })}</Label>
              <Input
                id="new-rate"
                name="hourlyRate"
                type="number"
                inputMode="numeric"
                min={0}
                step={10}
                defaultValue={0}
              />
            </div>
            <input type="hidden" name="sortOrder" value={nextOrder} />
            <label className={cn(check, "col-span-2")}>
              <input
                type="checkbox"
                name="bookableOnline"
                className="size-5 accent-primary"
              />
              {t("online")}
            </label>
            <div className="col-span-2 sm:col-span-4">
              <Button type="submit" size="lg">
                {t("create")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
