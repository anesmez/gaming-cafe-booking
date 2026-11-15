"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { placeOnlineBooking } from "@/server/public-booking";

export interface BookState {
  /** A key of book.errors in messages/fr.json. */
  error?: string;
  /** Bumped on SLOT_TAKEN so the form reloads the free slots. */
  refresh?: number;
}

export async function bookAction(previous: BookState, formData: FormData): Promise<BookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "LOGIN" };

  const result = await placeOnlineBooking(user, {
    resourceType: String(formData.get("resourceType") ?? "") as "pc" | "console",
    start: String(formData.get("start") ?? ""),
    durationMinutes: String(formData.get("durationMinutes") ?? ""),
    count: String(formData.get("count") ?? "1"),
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });

  if (!result.ok) {
    return {
      error: result.error,
      refresh: result.error === "SLOT_TAKEN" ? (previous.refresh ?? 0) + 1 : previous.refresh,
    };
  }

  redirect(`/booking/${result.code}?t=${encodeURIComponent(result.manageToken)}&new=1`);
}
