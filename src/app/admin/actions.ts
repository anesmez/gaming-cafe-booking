"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hasRole } from "@/lib/auth/roles";
import { BookingError, addMinutes } from "@/lib/booking";
import {
  cancelBooking,
  checkInBooking,
  completeBooking,
  createBooking,
  markNoShow,
  moveBooking,
} from "@/server/booking-service";
import { notify } from "@/server/email/notify";
import { getCurrentUser } from "@/server/session";

/**
 * Staff actions. Every one re-checks the role on the server and goes through
 * the booking engine; the engine refuses conflicts, there is no override.
 */

async function staffActor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!hasRole(user.role, "staff")) throw new BookingError("FORBIDDEN");
  return { role: user.role, userId: user.id };
}

const codeSchema = z.string().trim().min(1).max(20);

function detailUrl(code: string, query: string) {
  return `/admin/bookings/${encodeURIComponent(code)}?${query}`;
}

function errorCode(error: unknown): string {
  if (error instanceof BookingError) return error.code;
  console.error("staff action failed:", error);
  return "other";
}

type StatusAction = "checkIn" | "noShow" | "complete" | "cancel";

const STATUS_ACTIONS = {
  checkIn: { run: checkInBooking, done: "checked_in" },
  noShow: { run: markNoShow, done: "no_show" },
  complete: { run: completeBooking, done: "completed" },
  cancel: { run: cancelBooking, done: "cancelled" },
} as const;

/** One form posts here with name="action" on the pressed button. */
export async function bookingStatusAction(formData: FormData): Promise<void> {
  const code = codeSchema.parse(formData.get("code"));
  const action = z.enum(["checkIn", "noShow", "complete", "cancel"]).parse(formData.get("action")) as StatusAction;

  let target: string;
  try {
    const actor = await staffActor();
    await STATUS_ACTIONS[action].run({ code, actor });
    target = detailUrl(code, `done=${STATUS_ACTIONS[action].done}`);
  } catch (error) {
    target = detailUrl(code, `error=${errorCode(error)}`);
  }
  redirect(target);
}

const scheduleSchema = z.object({
  start: z.iso.datetime().transform((v) => new Date(v)),
  durationMinutes: z.coerce.number().int().positive(),
  resourceIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1),
});

export interface StaffFormState {
  error?: string;
}

export async function createStaffBookingAction(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const parsed = scheduleSchema
    .extend({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().min(6).max(20),
      email: z.union([z.literal(""), z.string().trim().toLowerCase().pipe(z.email())]),
      source: z.enum(["phone", "whatsapp", "walkin"]),
      notes: z.string().trim().max(500),
    })
    .safeParse({
      start: formData.get("start"),
      durationMinutes: formData.get("durationMinutes"),
      resourceIds: formData.getAll("resourceIds"),
      name: formData.get("name") ?? "",
      phone: formData.get("phone") ?? "",
      email: formData.get("email") ?? "",
      source: formData.get("source"),
      notes: formData.get("notes") ?? "",
    });
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const input = parsed.data;

  let code: string;
  try {
    const actor = await staffActor();
    const { booking, manageToken } = await createBooking({
      actor,
      stations: { mode: "explicit", resourceIds: input.resourceIds },
      start: input.start,
      end: addMinutes(input.start, input.durationMinutes),
      customer: { name: input.name, phone: input.phone, ...(input.email ? { email: input.email } : {}) },
      source: input.source,
      ...(input.notes ? { notes: input.notes } : {}),
    });
    code = booking.code;
    if (booking.customer.email) await notify({ type: "booking_confirmed", booking, manageToken });
  } catch (error) {
    return { error: errorCode(error) };
  }
  redirect(detailUrl(code, "done=created"));
}

export async function moveStaffBookingAction(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const code = codeSchema.safeParse(formData.get("code"));
  const parsed = scheduleSchema.safeParse({
    start: formData.get("start"),
    durationMinutes: formData.get("durationMinutes"),
    resourceIds: formData.getAll("resourceIds"),
  });
  if (!code.success || !parsed.success) return { error: "INVALID_INPUT" };

  try {
    const actor = await staffActor();
    await moveBooking({
      code: code.data,
      actor,
      start: parsed.data.start,
      end: addMinutes(parsed.data.start, parsed.data.durationMinutes),
      resourceIds: parsed.data.resourceIds,
    });
  } catch (error) {
    return { error: errorCode(error) };
  }
  redirect(detailUrl(code.data, "done=moved"));
}
