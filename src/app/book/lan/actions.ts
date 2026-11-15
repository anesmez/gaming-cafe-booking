"use server";

import { redirect } from "next/navigation";
import { placeLanRequest } from "@/server/public-booking";
import { getCurrentUser } from "@/server/session";
import type { BookState } from "../actions";

export async function lanAction(previous: BookState, formData: FormData): Promise<BookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "LOGIN" };

  const result = await placeLanRequest(user, {
    start: String(formData.get("start") ?? ""),
    durationMinutes: String(formData.get("durationMinutes") ?? ""),
    partySize: String(formData.get("partySize") ?? ""),
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!result.ok) {
    return {
      error: result.error,
      refresh: result.error === "SLOT_TAKEN" ? (previous.refresh ?? 0) + 1 : previous.refresh,
    };
  }
  redirect(`/booking/${result.code}?t=${encodeURIComponent(result.manageToken)}&new=1`);
}
