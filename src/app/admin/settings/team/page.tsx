import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listTeam } from "@/server/admin-config";
import { requireStaffUser } from "@/server/staff";
import { addStaffAction, removeStaffAction } from "../../config-actions";
import { Forbidden, OwnerOnly } from "../../_components/gate";
import { Notices } from "../../_components/notices";
import { SettingsNav } from "../../_components/settings-nav";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function TeamPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("admin");
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}
    >
      <Team searchParams={searchParams} />
    </Suspense>
  );
}

async function Team({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/settings/team");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;
  if (gate.user.role !== "owner") return <OwnerOnly />;

  const [t, ts, query, team] = await Promise.all([
    getTranslations("admin.team"),
    getTranslations("admin.settings"),
    searchParams,
    listTeam(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{ts("title")}</h1>
        <SettingsNav current="team" />
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
      </div>
      <Notices query={query} doneKey="team.done" />

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {team.map((m) => (
          <li
            key={m.id}
            data-testid="team-member"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{m.email}</p>
              <p className="text-sm text-muted-foreground">
                {t(`roles.${m.role}`)}
              </p>
            </div>
            {m.role === "staff" ? (
              <form action={removeStaffAction}>
                <input type="hidden" name="id" value={m.id} />
                <Button type="submit" variant="outline">
                  {t("remove")}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      <Card>
        <CardContent className="pt-5">
          <form
            action={addStaffAction}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                required
              />
            </div>
            <Button type="submit" size="lg">
              {t("add")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
