import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCustomers } from "@/server/admin-config";
import { getEditableSettings } from "@/server/admin-config";
import { requireStaffUser } from "@/server/staff";
import { customerAction } from "../config-actions";
import { Forbidden } from "../_components/gate";
import { Notices } from "../_components/notices";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CustomersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("admin");
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}
    >
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/customers");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.slice(0, 80) : "";
  const blockedOnly = query.blocked === "1";
  const [t, customers, settings] = await Promise.all([
    getTranslations("admin.customers"),
    listCustomers({ q, blockedOnly }),
    getEditableSettings(),
  ]);
  const isOwner = gate.user.role === "owner";

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("lead", { limit: settings?.noShowLimit ?? 3 })}
        </p>
      </div>
      <Notices query={query} doneKey="customers.done" />

      <form className="flex flex-wrap items-center gap-3" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          aria-label={t("search")}
          className="min-w-0 flex-1 basis-56"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="blocked"
            value="1"
            defaultChecked={blockedOnly}
            className="size-5 accent-primary"
          />
          {t("blockedOnly")}
        </label>
        <Button type="submit" variant="outline" size="lg">
          {t("filter")}
        </Button>
      </form>

      {customers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {customers.map((c) => (
            <li
              key={c.id}
              data-testid="customer"
              className="flex flex-col gap-3 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {c.name || c.email}
                    {c.blocked ? (
                      <span className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                        {t("blocked")}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[c.name ? c.email : null, c.phone || null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("bookings", { count: c.bookings })} ·{" "}
                    {t("noShows", { count: c.noShowCount })}
                  </p>
                </div>
                <form action={customerAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="q" value={q} />
                  <Button
                    type="submit"
                    name="action"
                    value={c.blocked ? "unblock" : "block"}
                    variant="outline"
                  >
                    {c.blocked ? t("unblock") : t("block")}
                  </Button>
                </form>
              </div>
              {isOwner ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("delete")}
                  </summary>
                  <form
                    action={customerAction}
                    className="mt-2 flex flex-col gap-2"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        name="confirm"
                        className="mt-0.5 size-5 shrink-0 accent-primary"
                      />
                      {t("deleteConfirm")}
                    </label>
                    <Button
                      type="submit"
                      name="action"
                      value="delete"
                      variant="outline"
                      className="self-start border-destructive text-destructive"
                    >
                      {t("delete")}
                    </Button>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
