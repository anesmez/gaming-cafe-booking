import { durationOptions } from "@/lib/booking";
import type { DaySchedule } from "@/server/booking-service";
import type { PublicSettings } from "@/server/public-booking";
import type { StaffFormRow } from "./staff-booking-form";

/** Turns a day schedule into the free/busy rows the staff form needs. */
export function formProps(schedule: DaySchedule, settings: PublicSettings, now: Date, selfId?: string) {
  const rows: StaffFormRow[] = schedule.rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    bookableOnline: r.bookableOnline,
    // A slot this booking already holds is free for moving it.
    free: r.slots.map((holder) => holder === null || holder === selfId),
  }));
  const slotMs = schedule.slotMinutes * 60_000;
  const first = schedule.slotStarts.findIndex((s) => s.getTime() + slotMs > now.getTime());

  return {
    date: schedule.date,
    slotStarts: schedule.slotStarts.map((s) => s.toISOString()),
    slotMinutes: schedule.slotMinutes,
    rows,
    durations: durationOptions(settings.station, settings.slotMinutes),
    timezone: schedule.timezone,
    firstOpenSlot: first === -1 ? schedule.slotStarts.length : first,
  };
}
