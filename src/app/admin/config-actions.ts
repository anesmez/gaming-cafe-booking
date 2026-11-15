"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hasRole } from "@/lib/auth/roles";
import {
  BookingError,
  settingsFormSchema,
  toStoredSettings,
  type SettingsForm,
  type SettingsIssue,
} from "@/lib/booking";
import {
  addStaff,
  createStation,
  getEditableSettings,
  removeStaff,
  saveSettings,
  setCustomerBlocked,
  updateStation,
} from "@/server/admin-config";
import {
  createClosure,
  deleteCustomer,
  removeClosure,
} from "@/server/booking-service";
import { getCurrentUser } from "@/server/session";

/**
 * Owner configuration and the customer blocklist. Every action re-checks the
 * role on the server; the functions it calls check it again.
 */

async function actor(minimum: "staff" | "owner", returnTo: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (!hasRole(user.role, minimum)) throw new BookingError("FORBIDDEN");
  return { role: user.role, userId: user.id };
}

/** BookingError code, or the detail for the few codes that carry one (NAME_TAKEN, STATION_IN_USE). */
function errorCode(error: unknown): string {
  if (error instanceof BookingError) {
    return error.message === "NAME_TAKEN" || error.message === "STATION_IN_USE"
      ? error.message
      : error.code;
  }
  console.error("settings action failed:", error);
  return "other";
}

function to(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params)}`);
}

const checkbox = (formData: FormData, name: string) =>
  formData.get(name) === "on";

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------

export interface SettingsState {
  /** The values that were sent, so a refused form keeps what the owner typed. */
  values?: SettingsForm;
  issues?: SettingsIssue[];
  error?: string;
  /** Changes on every submit, to remount the form with `values`. */
  attempt?: number;
}

const FIELDS = [
  "venueName",
  "address",
  "stationMinHours",
  "stationMaxHours",
  "stationMinLeadMinutes",
  "stationMaxAdvanceDays",
  "stationCancelCutoffHours",
  "maxStationsPerBooking",
  "venueMinHours",
  "venueMinLeadHours",
  "venueMaxAdvanceDays",
  "venueCancelCutoffHours",
  "approvalTimeoutHours",
  "venueBufferMinutes",
  "graceMinutes",
  "maxUpcomingPerCustomer",
  "noShowLimit",
] as const;

export async function saveSettingsAction(
  prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const raw: Record<string, unknown> = Object.fromEntries(
    FIELDS.map((f) => [f, String(formData.get(f) ?? "")]),
  );
  raw.days = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    closed: !checkbox(formData, `day${d}Open`),
    open: String(formData.get(`day${d}From`) ?? ""),
    close: String(formData.get(`day${d}To`) ?? ""),
  }));
  const attempt = (prev.attempt ?? 0) + 1;
  // Keep what was typed even when it does not parse.
  const echo = raw as unknown as SettingsForm;

  const parsed = settingsFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map((i) =>
          String(
            i.path[0] === "days" ? `days.${String(i.path[1])}` : i.path[0],
          ),
        ),
      ),
    ];
    return {
      values: echo,
      issues: fields.map((field) => ({ field, code: "range" })),
      attempt,
    };
  }

  try {
    const a = await actor("owner", "/admin/settings");
    const current = await getEditableSettings();
    if (!current) throw new BookingError("NOT_FOUND");
    const stored = toStoredSettings(parsed.data, current.slotMinutes);
    if (!stored.ok)
      return { values: parsed.data, issues: stored.issues, attempt };
    await saveSettings(a, stored.settings);
  } catch (error) {
    return { values: parsed.data, error: errorCode(error), attempt };
  }
  redirect("/admin/settings?done=saved");
}

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

const closureForm = z.object({
  from: z.string(),
  to: z.string(),
  resourceId: z.union([z.literal(""), z.string().regex(/^[a-f0-9]{24}$/i)]),
  reason: z.string().trim().min(2).max(80),
});

export async function createClosureAction(formData: FormData): Promise<void> {
  const page = "/admin/settings/closures";
  const parsed = closureForm.safeParse({
    from: formData.get("from"),
    to: formData.get("to") || formData.get("from"),
    resourceId: formData.get("resourceId") ?? "",
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) to(page, { error: "INVALID_INPUT" });
  const { resourceId, ...rest } = parsed.data;
  let params: Record<string, string>;
  try {
    const closure = await createClosure({
      actor: await actor("owner", page),
      ...rest,
      ...(resourceId ? { resourceId } : {}),
    });
    params = { done: "closed", code: closure.code };
  } catch (error) {
    const code = errorCode(error);
    params = { error: code === "SLOT_TAKEN" ? "SLOT_TAKEN_CLOSURE" : code };
  }
  to(page, params);
}

export async function removeClosureAction(formData: FormData): Promise<void> {
  const page = "/admin/settings/closures";
  let params: Record<string, string>;
  try {
    await removeClosure({
      code: String(formData.get("code") ?? ""),
      actor: await actor("owner", page),
    });
    params = { done: "reopened" };
  } catch (error) {
    params = { error: errorCode(error) };
  }
  to(page, params);
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

function stationFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    hourlyRate: String(formData.get("hourlyRate") ?? ""),
    sortOrder: String(formData.get("sortOrder") ?? ""),
    bookableOnline: checkbox(formData, "bookableOnline"),
  };
}

export async function createStationAction(formData: FormData): Promise<void> {
  const page = "/admin/stations";
  let params: Record<string, string>;
  try {
    const type = formData.get("type") === "console" ? "console" : "pc";
    await createStation(await actor("owner", page), {
      type,
      ...stationFields(formData),
    });
    params = { done: "added" };
  } catch (error) {
    params = { error: errorCode(error) };
  }
  to(page, params);
}

export async function updateStationAction(formData: FormData): Promise<void> {
  const page = "/admin/stations";
  let params: Record<string, string>;
  try {
    await updateStation(await actor("owner", page), {
      id: String(formData.get("id") ?? ""),
      active: checkbox(formData, "active"),
      ...stationFields(formData),
    });
    params = { done: "saved" };
  } catch (error) {
    params = { error: errorCode(error) };
  }
  to(page, params);
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function addStaffAction(formData: FormData): Promise<void> {
  const page = "/admin/settings/team";
  let params: Record<string, string>;
  try {
    await addStaff(
      await actor("owner", page),
      String(formData.get("email") ?? ""),
    );
    params = { done: "added" };
  } catch (error) {
    params = { error: errorCode(error) };
  }
  to(page, params);
}

export async function removeStaffAction(formData: FormData): Promise<void> {
  const page = "/admin/settings/team";
  let params: Record<string, string>;
  try {
    await removeStaff(
      await actor("owner", page),
      String(formData.get("id") ?? ""),
    );
    params = { done: "removed" };
  } catch (error) {
    params = { error: errorCode(error) };
  }
  to(page, params);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function customerAction(formData: FormData): Promise<void> {
  const page = "/admin/customers";
  const id = String(formData.get("id") ?? "");
  const what = String(formData.get("action") ?? "");
  const q = String(formData.get("q") ?? "");
  let params: Record<string, string>;
  try {
    if (what === "block" || what === "unblock") {
      await setCustomerBlocked(
        await actor("staff", page),
        id,
        what === "block",
      );
      params = { done: what === "block" ? "blocked" : "unblocked" };
    } else if (what === "delete") {
      if (formData.get("confirm") !== "on")
        throw new BookingError("INVALID_INPUT", "CONFIRM");
      await deleteCustomer({ userId: id, actor: await actor("owner", page) });
      params = { done: "deleted" };
    } else {
      throw new BookingError("INVALID_INPUT");
    }
  } catch (error) {
    params = {
      error:
        error instanceof BookingError && error.message === "CONFIRM"
          ? "CONFIRM"
          : errorCode(error),
    };
  }
  to(page, q ? { ...params, q } : params);
}
