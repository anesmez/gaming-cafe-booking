import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listPendingRequests } from "@/server/booking-service";
import { getPublicSettings } from "@/server/public-booking";
import { requireStaffUser } from "@/server/staff";
import { decideRequestAction } from "../actions";
import { Forbidden } from "../_components/gate";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function RequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const t = useTranslations("admin");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const gate = await requireStaffUser("/admin/requests");
  if (!gate.allowed) return <Forbidden email={gate.user.email} />;

  const [t, query, settings] = await Promise.all([getTranslations("admin"), searchParams, getPublicSettings()]);
  const requests = await listPendingRequests();
  const tz = settings?.timezone ?? "Africa/Algiers";
  const fmt = (d: Date, p: string) => formatInTimeZone(d, tz, p, { locale: fr });
  const isOwner = gate.user.role === "owner";
  const done = typeof query.done === "string" ? query.done : null;
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("requests.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("requests.lead", { hours: settings?.venue.approvalTimeoutHours ?? 24 })}
        </p>
      </div>

      {done && t.has(`requests.done.${done}`) ? (
        <p role="status" className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          {t(`requests.done.${done}`)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.other")}
        </p>
      ) : null}
      {!isOwner ? <p className="text-sm text-muted-foreground">{t("requests.ownerOnly")}</p> : null}

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("requests.empty")}</p>
      ) : (
        requests.map((r) => (
          <Card key={r.id} data-testid="lan-request">
            <CardHeader className="gap-1">
              <CardTitle className="capitalize-first">
                {fmt(r.start, "EEEE d MMMM")}, {fmt(r.start, "HH:mm")} – {fmt(r.end, "HH:mm")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {r.code} · {t("requests.expires", { date: fmt(r.expiresAt, "EEEE d MMMM 'à' HH:mm") })}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("requests.customer")}</dt>
                <dd>
                  {r.customerName} ·{" "}
                  <a href={`tel:${r.customerPhone.replace(/\s+/g, "")}`} className="underline underline-offset-4">
                    {r.customerPhone}
                  </a>
                </dd>
                {r.partySize ? (
                  <>
                    <dt className="text-muted-foreground">{t("requests.group")}</dt>
                    <dd>{t("requests.groupValue", { count: r.partySize })}</dd>
                  </>
                ) : null}
                {r.notes ? (
                  <>
                    <dt className="text-muted-foreground">{t("requests.notes")}</dt>
                    <dd className="whitespace-pre-line break-words">{r.notes}</dd>
                  </>
                ) : null}
              </dl>

              {isOwner ? (
                <form action={decideRequestAction} className="flex flex-col gap-3">
                  <input type="hidden" name="code" value={r.code} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`price-${r.id}`}>{t("requests.price")}</Label>
                      <Input
                        id={`price-${r.id}`}
                        name="quotedPrice"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={100}
                        placeholder={t("requests.pricePlaceholder")}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`note-${r.id}`}>{t("requests.note")}</Label>
                      <Input id={`note-${r.id}`} name="note" maxLength={500} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="decision" value="approve" size="lg">
                      {t("requests.approve")}
                    </Button>
                    <Button type="submit" name="decision" value="reject" variant="outline" size="lg">
                      {t("requests.reject")}
                    </Button>
                    <Button asChild variant="ghost" size="lg">
                      <Link href={`/admin/bookings/${r.code}`}>{t("requests.open")}</Link>
                    </Button>
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
