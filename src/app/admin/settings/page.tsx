import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { toSettingsForm } from "@/lib/booking";
import { currencyLabel } from "@/server/email/compose";
import { getEditableSettings } from "@/server/admin-config";
import { getPublicSettings } from "@/server/public-booking";
import { requireStaffUser } from "@/server/staff";
import { Forbidden, OwnerOnly } from "../_components/gate";
import { Notices } from "../_components/notices";
import { SettingsNav } from "../_components/settings-nav";
import { SettingsFormView } from "./settings-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("admin");
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}
    >
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/settings");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;
  if (gate.user.role !== "owner") return <OwnerOnly />;

  const [t, query, current, pub] = await Promise.all([
    getTranslations("admin.settings"),
    searchParams,
    getEditableSettings(),
    getPublicSettings(),
  ]);
  if (!current || !pub) return null;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <SettingsNav current="rules" />
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </div>
      <Notices query={query} doneKey="settings.done" />
      <SettingsFormView initial={toSettingsForm(current)} />
      <p className="text-xs text-muted-foreground">
        {t("fixed", {
          slot: current.slotMinutes,
          timezone: pub.timezone,
          currency: currencyLabel(current.currency),
        })}
      </p>
    </div>
  );
}
