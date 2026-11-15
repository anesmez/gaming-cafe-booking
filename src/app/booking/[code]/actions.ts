"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { cancelManagedBooking } from "@/server/public-booking";
import { getCurrentUser } from "@/server/session";

export interface CancelState {
  error?: string;
}

const inputSchema = z.object({
  code: z.string().min(1).max(20),
  token: z.string().max(200).optional(),
});

export async function cancelAction(_previous: CancelState, formData: FormData): Promise<CancelState> {
  const parsed = inputSchema.safeParse({
    code: formData.get("code"),
    token: formData.get("token") || undefined,
  });
  if (!parsed.success) return { error: "NOT_FOUND" };

  const user = await getCurrentUser();
  const result = await cancelManagedBooking(parsed.data.code, parsed.data.token, user);
  if (!result.ok) return { error: result.error };

  const query = parsed.data.token ? `?t=${encodeURIComponent(parsed.data.token)}` : "";
  redirect(`/booking/${parsed.data.code}${query}`);
}
