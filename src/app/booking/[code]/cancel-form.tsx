"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cancelAction, type CancelState } from "./actions";

export function CancelForm({ code, token }: { code: string; token?: string }) {
  const t = useTranslations("manage");
  const [state, action, pending] = useActionState<CancelState, FormData>(cancelAction, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="code" value={code} />
      {token ? <input type="hidden" name="token" value={token} /> : null}
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        {pending ? t("cancelling") : t("cancel")}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error === "CUTOFF_PASSED" ? t("cancelClosed") : t("cancelError")}
        </p>
      ) : null}
    </form>
  );
}
