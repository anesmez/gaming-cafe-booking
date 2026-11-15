"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hasRole } from "@/lib/auth/roles";
import { BookingError, addMinutes } from "@/lib/booking";
import {
  approveVenueBooking,
  cancelBooking,
  checkInBooking,
  completeBooking,
  createBooking,
  getBookingByCode,
  markNoShow,
  moveBooking,
  rejectVenueBooking,
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
    const booking = await STATUS_ACTIONS[action].run({ code, actor });
    if (action === "cancel") await notify({ type: "booking_cancelled", booking, byCustomer: false });
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
    const before = await getBookingByCode(code.data);
    const moved = await moveBooking({
      code: code.data,
      actor,
      start: parsed.data.start,
      end: addMinutes(parsed.data.start, parsed.data.durationMinutes),
      resourceIds: parsed.data.resourceIds,
    });
    // The customer picks a time, not a PC: only a new time is worth an email.
    if (moved.start.getTime() !== before.start.getTime() || moved.end.getTime() !== before.end.getTime()) {
      await notify({ type: "booking_moved", booking: moved, previous: { start: before.start, end: before.end } });
    }
  } catch (error) {
    return { error: errorCode(error) };
  }
  redirect(detailUrl(code.data, "done=moved"));
}

const decisionForm = z.object({
  code: codeSchema,
  decision: z.enum(["approve", "reject"]),
  quotedPrice: z.union([z.literal(""), z.coerce.number().int().min(0).max(10_000_000)]),
  note: z.string().trim().max(500),
});

/** Owner only: answer a LAN request, and tell the customer. */
export async function decideRequestAction(formData: FormData): Promise<void> {
  const parsed = decisionForm.safeParse({
    code: formData.get("code"),
    decision: formData.get("decision"),
    quotedPrice: formData.get("quotedPrice") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) redirect("/admin/requests?error=INVALID_INPUT");
  const { code, decision, quotedPrice, note } = parsed.data;

  let target: string;
  try {
    const actor = await staffActor();
    const input = {
      code,
      actor,
      ...(note ? { note } : {}),
      ...(decision === "approve" && quotedPrice !== "" ? { quotedPrice } : {}),
    };
    const booking = decision === "approve" ? await approveVenueBooking(input) : await rejectVenueBooking(input);
    await notify({ type: "lan_decided", booking, decision: decision === "approve" ? "approved" : "rejected", ...(note ? { note } : {}) });
    target = `/admin/requests?done=${decision === "approve" ? "approved" : "rejected"}&code=${code}`;
  } catch (error) {
    target = `/admin/requests?error=${errorCode(error)}`;
  }
  redirect(target);
}
