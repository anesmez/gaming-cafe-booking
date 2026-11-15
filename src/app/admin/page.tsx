import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasRole } from "@/lib/auth/roles";
import { getCurrentUser } from "@/server/session";
import { signOut } from "../login/actions";

/**
 * Staff area. Milestone 5 puts the dashboard here; for now it proves the role
 * check: customers and anonymous visitors never see staff content.
 */
export default function AdminPage() {
  const t = useTranslations("admin");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 sm:py-14">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {/* The session is read at request time, so it streams in behind this boundary. */}
      <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
        <AdminHome />
      </Suspense>
    </main>
  );
}

async function AdminHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");

  const t = await getTranslations("admin");
  const allowed = hasRole(user.role, "staff");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{allowed ? t(`roles.${user.role}`) : t("forbiddenTitle")}</CardTitle>
        <CardDescription>
          {allowed ? t("signedInAs", { email: user.email }) : t("forbiddenLead", { email: user.email })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {allowed ? <p className="text-sm text-muted-foreground">{t("comingSoon")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <form action={signOut}>
            <Button type="submit" variant="outline">
              {t("signOut")}
            </Button>
          </form>
          <Button asChild variant="ghost">
            <Link href="/">{t("home")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
