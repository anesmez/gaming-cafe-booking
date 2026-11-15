import { Gamepad2, Monitor, Users } from "lucide-react";
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 py-10 sm:py-16">
      <header className="text-sm font-semibold tracking-wide">{t("app.name")}</header>

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
        {/* Becomes a link to /book in milestone 4. */}
        <Button size="lg" disabled className="w-full sm:w-fit">
          {t("home.bookSoon")}
        </Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {OFFERS.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardHeader>
              <Icon className="mb-2 size-5 text-primary" aria-hidden />
              <CardTitle>{t(`home.offers.${key}.title`)}</CardTitle>
              <CardDescription>{t(`home.offers.${key}.description`)}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <footer className="mt-auto text-sm text-muted-foreground">{t("home.payOnSite")}</footer>
    </main>
  );
}
