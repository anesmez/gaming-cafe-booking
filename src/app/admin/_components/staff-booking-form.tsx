"use client";

import { formatInTimeZone } from "date-fns-tz";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createStaffBookingAction, moveStaffBookingAction, type StaffFormState } from "../actions";

export interface StaffFormRow {
  id: string;
  name: string;
  type: "pc" | "console";
  bookableOnline: boolean;
  /** Per slot of the day: free for this booking (slots it already holds count as free). */
  free: boolean[];
}

interface Props {
  mode: "create" | "move";
  code?: string;
  date: string;
  slotStarts: string[];
  slotMinutes: number;
  rows: StaffFormRow[];
  durations: number[];
  timezone: string;
  /** Slots before this index have fully passed. */
  firstOpenSlot: number;
  initial: { type: "pc" | "console"; start?: string; durationMinutes: number; resourceIds: string[] };
}

const select = "h-12 w-full rounded-md border border-border bg-background px-3 text-base";

export function StaffBookingForm(props: Props) {
  const { mode, code, date, slotStarts, slotMinutes, rows, durations, timezone, firstOpenSlot, initial } = props;
  const t = useTranslations("admin");
  const tb = useTranslations("book");
  const router = useRouter();
  const pathname = usePathname();
  const [state, action, pending] = useActionState<StaffFormState, FormData>(
    mode === "create" ? createStaffBookingAction : moveStaffBookingAction,
    {},
  );

  const [type, setType] = useState(initial.type);
  const [start, setStart] = useState(
    initial.start && slotStarts.includes(initial.start) ? initial.start : (slotStarts[firstOpenSlot] ?? ""),
  );
  const [duration, setDuration] = useState(initial.durationMinutes);
  const [picked, setPicked] = useState<string[]>(initial.resourceIds);

  const startIndex = slotStarts.indexOf(start);
  const span = duration / slotMinutes;
  const fits = startIndex >= 0 && startIndex + span <= slotStarts.length;

  // Which stations are free for the whole chosen range.
  const freeFor = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of rows) {
      map.set(row.id, fits && row.free.slice(startIndex, startIndex + span).every(Boolean));
    }
    return map;
  }, [rows, fits, startIndex, span]);

  const visibleRows = rows.filter((r) => r.type === type);
  const chosen = picked.filter((id) => visibleRows.some((r) => r.id === id) && freeFor.get(id));
  const durationLabel = (m: number) => tb("durationValue", { hours: Math.floor(m / 60), half: m % 60 ? "yes" : "no" });

  return (
    <form action={action} className="flex flex-col gap-6">
      {code ? <input type="hidden" name="code" value={code} /> : null}
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="durationMinutes" value={duration} />
      {chosen.map((id) => (
        <input key={id} type="hidden" name="resourceIds" value={id} />
      ))}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">{t("date")}</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              const params = new URLSearchParams(window.location.search);
              params.set("date", e.target.value);
              params.delete("start");
              router.replace(`${pathname}?${params.toString()}`);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start">{t("start")}</Label>
          <select id="start" className={select} value={start} onChange={(e) => setStart(e.target.value)}>
            {slotStarts.map((s, i) =>
              i < firstOpenSlot ? null : (
                <option key={s} value={s}>
                  {formatInTimeZone(new Date(s), timezone, "HH:mm")}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="duration">{t("duration")}</Label>
          <select id="duration" className={select} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">{t("stations")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["pc", "console"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={cn(
                "h-11 rounded-md border text-sm font-medium",
                type === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
              )}
            >
              {tb(`types.${value}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {visibleRows.map((row) => {
            const free = freeFor.get(row.id) ?? false;
            const on = chosen.includes(row.id);
            return (
              <label
                key={row.id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                  !free && "cursor-not-allowed opacity-50",
                  on ? "border-primary bg-primary/15" : "border-border bg-card",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={on}
                  disabled={!free}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, row.id] : p.filter((id) => id !== row.id)))
                  }
                />
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">{row.name}</span>
                  {!free ? <span className="text-xs">{t("stationBusy")}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode === "create" ? (
        <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">{t("customer")}</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" required maxLength={80} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" required minLength={6} maxLength={20} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source">{t("source")}</Label>
            <select id="source" name="source" className={select} defaultValue="phone">
              {(["phone", "whatsapp", "walkin"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`sources.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="notes">{t("notes")}</Label>
            <Input id="notes" name="notes" maxLength={500} />
          </div>
        </fieldset>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.other")}
        </p>
      ) : chosen.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pickStation")}</p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || chosen.length === 0 || !fits}>
        {pending ? t("saving") : mode === "create" ? t("create") : t("moveSave")}
      </Button>
    </form>
  );
}
