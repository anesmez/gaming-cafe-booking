import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "../../login/actions";

/** Shown to a logged-in customer who opens a staff page. */
export async function Forbidden({ email }: { email: string }) {
  const t = await getTranslations("admin");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("forbiddenTitle")}</CardTitle>
        <CardDescription>{t("forbiddenLead", { email })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <form action={signOut}>
          <Button type="submit" variant="outline">
            {t("signOut")}
          </Button>
        </form>
        <Button asChild variant="ghost">
          <Link href="/">{t("home")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Shown to staff who open an owner page. */
export async function OwnerOnly() {
  const t = await getTranslations("admin");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("forbiddenTitle")}</CardTitle>
        <CardDescription>{t("ownerOnly")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/admin">{t("nav.today")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
