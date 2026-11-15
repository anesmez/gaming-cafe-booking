import { Gamepad2, Monitor, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const OFFERS = [
  { key: "pc", icon: Monitor },
  { key: "ps5", icon: Gamepad2 },
  { key: "lan", icon: Users },
] as const;

export default function HomePage() {
  const t = useTranslations();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 py-8 sm:py-14">
      <header className="flex items-center gap-3">
        <Image
          src="/brand/emblem.png"
          alt={t("app.logoAlt")}
          width={44}
          height={44}
          priority
          className="rounded-xl ring-1 ring-border"
        />
        <span className="text-sm font-semibold uppercase tracking-[0.14em]">{t("app.name")}</span>
      </header>

      <section className="flex flex-col gap-5">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">
          {t("home.eyebrow")}
        </p>
        <h1 className="text-balance text-3xl font-semibold leading-tight sm:text-5xl">
          {t("home.headline")}
        </h1>
        <p className="max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
          {t("home.lead")}
        </p>
        <Button asChild size="lg" className="w-full sm:w-fit">
          <Link href="/book">{t("home.book")}</Link>
        </Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {OFFERS.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardHeader>
              <Icon className="mb-2 size-5 text-accent" aria-hidden />
              <CardTitle>{t(`home.offers.${key}.title`)}</CardTitle>
              <CardDescription>{t(`home.offers.${key}.description`)}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{t("home.payOnSite")}</span>
        <Link href="/admin" className="underline-offset-4 hover:underline">
          {t("home.staffLink")}
        </Link>
      </footer>
    </main>
  );
}
