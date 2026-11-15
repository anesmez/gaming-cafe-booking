"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SettingsForm } from "@/lib/booking";
import { cn } from "@/lib/utils";
import { saveSettingsAction, type SettingsState } from "../config-actions";

type NumberField = Exclude<
  keyof SettingsForm,
  "venueName" | "address" | "days"
>;

const GROUPS: {
  title: string;
  fields: { name: NumberField; step: number }[];
}[] = [
  {
    title: "stationRules",
    fields: [
      { name: "stationMinHours", step: 0.5 },
      { name: "stationMaxHours", step: 0.5 },
      { name: "stationMinLeadMinutes", step: 5 },
      { name: "stationMaxAdvanceDays", step: 1 },
      { name: "stationCancelCutoffHours", step: 0.5 },
      { name: "maxStationsPerBooking", step: 1 },
    ],
  },
  {
    title: "venueRules",
    fields: [
      { name: "venueMinHours", step: 0.5 },
      { name: "venueMinLeadHours", step: 1 },
      { name: "venueMaxAdvanceDays", step: 1 },
      { name: "venueCancelCutoffHours", step: 1 },
      { name: "approvalTimeoutHours", step: 1 },
      { name: "venueBufferMinutes", step: 30 },
    ],
  },
  {
    title: "customerRules",
    fields: [
      { name: "graceMinutes", step: 5 },
      { name: "maxUpcomingPerCustomer", step: 1 },
      { name: "noShowLimit", step: 1 },
    ],
  },
];

export function SettingsFormView({ initial }: { initial: SettingsForm }) {
  const t = useTranslations("admin.settings");
  const te = useTranslations("admin.errors");
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveSettingsAction,
    {},
  );
  const values = state.values ?? initial;
  const issues = state.issues ?? [];
  const issueFor = (field: string) => issues.find((i) => i.field === field);
  const weekdays = t.raw("weekdays") as string[];
  // Monday first, as the café thinks of its week.
  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <form
      key={state.attempt ?? 0}
      action={action}
      className="flex flex-col gap-5"
      noValidate
    >
      {issues.length > 0 || state.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm"
        >
          {state.error
            ? te.has(state.error)
              ? te(state.error)
              : te("other")
            : t("issuesTitle")}
          {issueFor("days") ? (
            <p>{t(`issues.${issueFor("days")!.code}`)}</p>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("venue")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="venueName"
            label={t("venueName")}
            issue={
              issueFor("venueName") &&
              t(`issues.${issueFor("venueName")!.code}`)
            }
          >
            <Input
              id="venueName"
              name="venueName"
              defaultValue={values.venueName}
              maxLength={80}
              required
            />
          </Field>
          <Field id="address" label={t("address")}>
            <Input
              id="address"
              name="address"
              defaultValue={values.address}
              maxLength={200}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle>{t("hours")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("hoursHint")}</p>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {order.map((d) => {
            const day = values.days[d];
            const issue = issueFor(`days.${d}`);
            return (
              <fieldset
                key={d}
                className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 py-3"
                data-testid={`day-${d}`}
              >
                <legend className="sr-only">{weekdays[d]}</legend>
                <label className="flex w-36 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name={`day${d}Open`}
                    defaultChecked={!day.closed}
                    className="size-5 accent-primary"
                  />
                  {weekdays[d]}
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  {t("from")}
                  <Input
                    type="time"
                    step={1800}
                    name={`day${d}From`}
                    defaultValue={day.open}
                    className="h-10 w-28"
                    aria-label={`${weekdays[d]} ${t("from")}`}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  {t("to")}
                  <Input
                    type="time"
                    step={1800}
                    name={`day${d}To`}
                    defaultValue={day.close}
                    className="h-10 w-28"
                    aria-label={`${weekdays[d]} ${t("to")}`}
                  />
                </label>
                {issue ? (
                  <p className="w-full text-sm text-destructive">
                    {t(`issues.${issue.code}`)}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
        </CardContent>
      </Card>

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{t(group.title)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((f) => {
              const issue = issueFor(f.name);
              return (
                <Field
                  key={f.name}
                  id={f.name}
                  label={t(f.name)}
                  issue={issue && t(`issues.${issue.code}`)}
                >
                  <Input
                    id={f.name}
                    name={f.name}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={f.step}
                    defaultValue={String(values[f.name])}
                    aria-invalid={issue ? true : undefined}
                    className={cn(issue && "border-destructive")}
                  />
                </Field>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  issue,
  children,
}: {
  id: string;
  label: string;
  issue?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {issue ? <p className="text-sm text-destructive">{issue}</p> : null}
    </div>
  );
}
