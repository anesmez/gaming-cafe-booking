"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

const INITIAL: LoginState = { step: "email", email: "" };

export function LoginForm() {
  const t = useTranslations("login");
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate={false}>
      <input type="hidden" name="next" value={next} />

      {state.step === "email" ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("emailLabel")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              defaultValue={state.email}
              placeholder={t("emailPlaceholder")}
              aria-describedby={state.error ? "login-error" : undefined}
            />
          </div>
          <Button type="submit" name="intent" value="request" size="lg" disabled={pending}>
            {pending ? t("sending") : t("sendCode")}
          </Button>
        </>
      ) : (
        <>
          <input type="hidden" name="email" value={state.email} />
          <p className="text-sm text-muted-foreground">{t("codeLead", { email: state.email })}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">{t("codeLabel")}</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              className="text-center font-mono text-2xl tracking-[0.4em]"
              aria-describedby={state.error ? "login-error" : undefined}
            />
          </div>
          <Button type="submit" name="intent" value="verify" size="lg" disabled={pending}>
            {pending ? t("verifying") : t("verify")}
          </Button>
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="submit" name="intent" value="request" variant="ghost" size="sm" formNoValidate disabled={pending}>
              {t("resend")}
            </Button>
            <Button type="submit" name="intent" value="reset" variant="ghost" size="sm" formNoValidate disabled={pending}>
              {t("changeEmail")}
            </Button>
          </div>
        </>
      )}

      {state.error ? (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}
