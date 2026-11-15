import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** Staff area frame. Each page checks the role itself, on the server. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const links = [
    { href: "/admin", label: t("admin.nav.today") },
    { href: "/admin/calendar", label: t("admin.nav.calendar") },
    { href: "/admin/requests", label: t("admin.nav.requests") },
    { href: "/admin/bookings", label: t("admin.nav.bookings") },
    { href: "/admin/bookings/new", label: t("admin.nav.new") },
  ];
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2">
          <Link href="/admin" aria-label={t("admin.title")} className="shrink-0">
            <Image src="/brand/emblem.png" alt={t("app.logoAlt")} width={32} height={32} className="rounded-lg" />
          </Link>
          <nav className="-mx-1 flex min-w-0 gap-1 overflow-x-auto" aria-label={t("admin.title")}>
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-5 px-4 py-5">{children}</div>
    </div>
  );
}
