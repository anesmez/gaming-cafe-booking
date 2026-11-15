import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { key: "rules", href: "/admin/settings" },
  { key: "closures", href: "/admin/settings/closures" },
  { key: "stations", href: "/admin/stations" },
  { key: "team", href: "/admin/settings/team" },
] as const;

/** Tabs across the owner's configuration pages. */
export async function SettingsNav({
  current,
}: {
  current: (typeof SECTIONS)[number]["key"];
}) {
  const t = await getTranslations("admin.settings");
  return (
    <nav
      aria-label={t("title")}
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-2"
    >
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          aria-current={s.key === current ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-3 py-2 text-sm font-medium",
            s.key === current
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t(`sections.${s.key}`)}
        </Link>
      ))}
    </nav>
  );
}
