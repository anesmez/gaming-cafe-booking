import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const t = useTranslations();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col items-start gap-4">
        <Image
          src="/brand/emblem.png"
          alt={t("app.logoAlt")}
          width={56}
          height={56}
          priority
          className="rounded-2xl ring-1 ring-border"
        />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("login.lead")}</p>
        </div>
      </header>

      {/* The form reads ?next= from the URL, which is only known at request time. */}
      <Suspense fallback={<div className="h-28" aria-hidden />}>
        <LoginForm />
      </Suspense>

      <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("login.back")}
      </Link>
    </main>
  );
}
