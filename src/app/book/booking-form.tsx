"use client";

import { formatInTimeZone } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bookableStarts, type DayGrid } from "@/lib/booking/picker";
import { cn } from "@/lib/utils";
import { bookAction, type BookState } from "./actions";

type ResourceType = "pc" | "console";

interface Props {
  dates: string[];
  durations: number[];
  maxStations: number;
  slotMinutes: number;
  station: { minLeadMinutes: number; maxAdvanceDays: number };
  timezone: string;
  nowIso: string;
  defaults: { name: string; phone: string };
}

type Loaded = { key: string } & ({ state: "error" } | { state: "ready"; open: boolean; grid: DayGrid });
type Load = { state: "loading" } | Loaded;

const chip =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipOn = "border-primary bg-primary text-primary-foreground";
const chipOff = "border-border bg-card hover:bg-muted";

export function BookingForm({ dates, durations, maxStations, slotMinutes, station, timezone, nowIso, defaults }: Props) {
  const t = useTranslations("book");
  const [type, setType] = useState<ResourceType>("pc");
  const [date, setDate] = useState(dates[0] ?? "");
  const [duration, setDuration] = useState(durations.includes(120) ? 120 : durations[0]);
  const [count, setCount] = useState(1);
  const [start, setStart] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The clock used to hide past slots. Set from the server's time, then moved
  // forward whenever fresh availability arrives.
  const [now, setNow] = useState(() => new Date(nowIso));
  const [state, action, pending] = useActionState<BookState, FormData>(bookAction, {});

  const effectiveCount = type === "console" ? 1 : count;

  // Fetch free slots for the chosen day; refetch after a lost race (state.refresh).
  // Whatever was loaded for another key counts as "still loading".
  const key = `${date}|${type}|${state.refresh ?? 0}`;
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    fetch(`/api/availability?date=${date}&type=${type}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { open: boolean; slotStarts: string[]; resources: { free: boolean[] }[] };
        if (cancelled) return;
        setNow(new Date());
        setLoaded({
          key,
          state: "ready",
          open: body.open,
          grid: { slotStarts: body.slotStarts.map((s) => new Date(s)), resources: body.resources },
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [date, type, key]);
  const load: Load = useMemo(() => (loaded && loaded.key === key ? loaded : { state: "loading" }), [loaded, key]);

  const starts = useMemo(() => {
    if (load.state !== "ready") return [];
    return bookableStarts(load.grid, {
      durationMinutes: duration,
      count: effectiveCount,
      slotMinutes,
      now,
      station,
    });
  }, [load, duration, effectiveCount, slotMinutes, station, now]);

  // Drop the chosen time when it is no longer offered.
  const chosen = starts.find((s) => s.start.toISOString() === start) ?? null;

  const fmt = (d: Date, pattern: string) => formatInTimeZone(d, timezone, pattern, { locale: fr });
  const durationLabel = (m: number) => t("durationValue", { hours: Math.floor(m / 60), half: m % 60 ? "yes" : "no" });

  return (
    <form action={action} className="flex flex-col gap-7">
      <input type="hidden" name="resourceType" value={type} />
      <input type="hidden" name="durationMinutes" value={duration} />
      <input type="hidden" name="count" value={effectiveCount} />
      {chosen ? <input type="hidden" name="start" value={chosen.start.toISOString()} /> : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">{t("what")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["pc", "console"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => {
                setType(value);
                setStart(null);
              }}
              className={cn(chip, "h-12", type === value ? chipOn : chipOff)}
            >
              {t(`types.${value}`)}
            </button>
          ))}
        </div>
        {type === "pc" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="count">{t("players")}</Label>
            <select
              id="count"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-12 rounded-md border border-border bg-background px-3 text-base"
            >
              {Array.from({ length: maxStations }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {t("playersValue", { count: n })}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("lanHint")}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">{t("when")}</legend>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1" role="radiogroup" aria-label={t("when")}>
          {dates.map((d, i) => {
            const day = new Date(`${d}T12:00:00Z`);
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={date === d}
                onClick={() => {
                  setDate(d);
                  setStart(null);
                }}
                className={cn(chip, "min-w-16 shrink-0 flex-col py-2 leading-tight", date === d ? chipOn : chipOff)}
              >
                <span className="text-xs capitalize opacity-80">
                  {i === 0 ? t("today") : formatInTimeZone(day, "UTC", "EEE", { locale: fr })}
                </span>
                <span className="text-base">{formatInTimeZone(day, "UTC", "d MMM", { locale: fr })}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="duration">{t("duration")}</Label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => {
              setDuration(Number(e.target.value));
            }}
            className="h-12 rounded-md border border-border bg-background px-3 text-base"
          >
            {durations.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">{t("time")}</legend>
        {load.state === "loading" ? (
          <p className="text-sm text-muted-foreground">{t("loadingSlots")}</p>
        ) : load.state === "error" ? (
          <p className="text-sm text-destructive">{t("slotsError")}</p>
        ) : !load.open ? (
          <p className="text-sm text-muted-foreground">{t("closed")}</p>
        ) : starts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSlots")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label={t("time")}>
            {starts.map((s) => {
              const iso = s.start.toISOString();
              return (
                <button
                  key={iso}
                  type="button"
                  role="radio"
                  aria-checked={chosen?.start.toISOString() === iso}
                  onClick={() => setStart(iso)}
                  className={cn(chip, "font-mono", chosen?.start.toISOString() === iso ? chipOn : chipOff)}
                >
                  {fmt(s.start, "HH:mm")}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-sm font-semibold">{t("you")}</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} defaultValue={defaults.name} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            pattern="\+?[0-9 .\-]{9,20}"
            defaultValue={defaults.phone}
            aria-describedby="phone-hint"
          />
          <p id="phone-hint" className="text-xs text-muted-foreground">
            {t("phoneHint")}
          </p>
        </div>
      </fieldset>

      <div className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        {chosen ? (
          <p className="text-sm">
            <span className="font-semibold capitalize">
              {t("summary", {
                date: fmt(chosen.start, "EEEE d MMMM"),
                start: fmt(chosen.start, "HH:mm"),
                end: fmt(chosen.end, "HH:mm"),
              })}
            </span>
            <span className="block text-xs text-muted-foreground">{t("payOnSite")}</span>
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.other")}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={!chosen || pending}>
          {pending ? t("confirming") : chosen ? t("confirm") : t("pickTime")}
        </Button>
      </div>
    </form>
  );
}
