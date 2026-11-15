"use client";

import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { venueStarts, type DayGrid } from "@/lib/booking/picker";
import { cn } from "@/lib/utils";
import type { BookState } from "../actions";
import { lanAction } from "./actions";

interface Props {
  minDate: string;
  maxDate: string;
  durations: number[];
  slotMinutes: number;
  bufferMinutes: number;
  venue: { minLeadHours: number; maxAdvanceDays: number };
  timezone: string;
  nowIso: string;
  defaults: { name: string; phone: string };
}

type Loaded = { key: string } & ({ state: "error" } | { state: "ready"; open: boolean; grid: DayGrid });

const select = "h-12 w-full rounded-md border border-border bg-background px-3 text-base";
const chip =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-medium font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LanForm(props: Props) {
  const { minDate, maxDate, durations, slotMinutes, bufferMinutes, venue, timezone, nowIso, defaults } = props;
  const t = useTranslations("lan");
  const tb = useTranslations("book");
  const [date, setDate] = useState(minDate);
  const [duration, setDuration] = useState(durations.includes(240) ? 240 : durations[0]);
  const [start, setStart] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [now, setNow] = useState(() => new Date(nowIso));
  const [state, action, pending] = useActionState<BookState, FormData>(lanAction, {});

  const key = `${date}|${state.refresh ?? 0}`;
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    fetch(`/api/availability?date=${date}&type=venue`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { open: boolean; slotStarts: string[]; resources: { free: boolean[] }[] };
        if (cancelled) return;
        setNow(new Date());
        setLoaded({ key, state: "ready", open: body.open, grid: { slotStarts: body.slotStarts.map((s) => new Date(s)), resources: body.resources } });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [date, key]);

  const load = useMemo(() => (loaded && loaded.key === key ? loaded : null), [loaded, key]);
  const starts = useMemo(
    () =>
      load?.state === "ready"
        ? venueStarts(load.grid, { durationMinutes: duration, bufferMinutes, slotMinutes, now, venue })
        : [],
    [load, duration, bufferMinutes, slotMinutes, now, venue],
  );
  const chosen = starts.find((s) => s.start.toISOString() === start) ?? null;
  const fmt = (d: Date, p: string) => formatInTimeZone(d, timezone, p, { locale: fr });

  return (
    <form action={action} className="flex flex-col gap-7">
      <input type="hidden" name="durationMinutes" value={duration} />
      {chosen ? <input type="hidden" name="start" value={chosen.start.toISOString()} /> : null}

      <fieldset className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lan-date">{t("date")}</Label>
          <Input
            id="lan-date"
            type="date"
            min={minDate}
            max={maxDate}
            value={date}
            onChange={(e) => {
              if (e.target.value) {
                setDate(e.target.value);
                setStart(null);
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{t("dateHint", { hours: venue.minLeadHours })}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lan-duration">{t("duration")}</Label>
          <select id="lan-duration" className={select} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((m) => (
              <option key={m} value={m}>
                {tb("durationValue", { hours: Math.floor(m / 60), half: m % 60 ? "yes" : "no" })}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">{t("time")}</legend>
        {!load ? (
          <p className="text-sm text-muted-foreground">{t("loadingSlots")}</p>
        ) : load.state === "error" ? (
          <p className="text-sm text-destructive">{tb("slotsError")}</p>
        ) : !load.open ? (
          <p className="text-sm text-muted-foreground">{t("closed")}</p>
        ) : starts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSlots")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label={t("time")}>
            {starts.map((s) => {
              const iso = s.start.toISOString();
              const on = chosen?.start.toISOString() === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setStart(iso)}
                  className={cn(chip, on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}
                >
                  {fmt(s.start, "HH:mm")}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-3 text-sm font-semibold">{tb("you")}</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partySize">{t("group")}</Label>
          <Input id="partySize" name="partySize" type="number" inputMode="numeric" min={2} max={100} required defaultValue={10} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{tb("name")}</Label>
          <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} defaultValue={defaults.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">{tb("phone")}</Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={9} maxLength={20} defaultValue={defaults.phone} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">{t("notes")}</Label>
          <textarea
            id="notes"
            name="notes"
            maxLength={500}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
          />
        </div>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-2 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        {chosen ? (
          <p className="text-sm">
            <span className="capitalize-first block font-semibold">
              {t("summary", { date: fmt(chosen.start, "EEEE d MMMM"), start: fmt(chosen.start, "HH:mm"), end: fmt(chosen.end, "HH:mm") })}
            </span>
            <span className="block text-xs text-muted-foreground">{t("priceNote")}</span>
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {tb.has(`errors.${state.error}`) ? tb(`errors.${state.error}`) : tb("errors.other")}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={!chosen || pending}>
          {pending ? t("submitting") : chosen ? t("submit") : t("pickTime")}
        </Button>
      </div>
    </form>
  );
}
