import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { currencyLabel } from "@/server/email/compose";
import { getPublicPrices, getPublicSettings } from "@/server/public-booking";

/**
 * Hours and prices, read live so the owner's changes show at once. Rendered
 * at request time inside the home page's Suspense boundary.
 */
export async function VenueInfo() {
  await connection();
  const [t, tw, settings, prices] = await Promise.all([
    getTranslations("home.info"),
    getTranslations("admin.settings"),
    getPublicSettings(),
    getPublicPrices(),
  ]);
  if (!settings) return null;
  const weekdays = tw.raw("weekdays") as string[];
  const currency = currencyLabel(settings.currency);

  return (
    <section className="grid gap-5 rounded-lg border border-border p-5 sm:grid-cols-2" aria-labelledby="venue-info">
      <h2 id="venue-info" className="sr-only">
        {t("title")}
      </h2>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("hours")}</h3>
        <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1 text-sm" data-testid="opening-hours">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const h = settings.openingHours.find((o) => o.weekday === d);
            return (
              <div key={d} className="contents">
                <dt className="text-muted-foreground">{weekdays[d]}</dt>
                <dd>{h ? t("range", { open: h.open, close: h.close }) : t("closed")}</dd>
              </div>
            );
          })}
        </dl>
        {settings.address ? <p className="text-sm text-muted-foreground">{settings.address}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("prices")}</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {prices.pc ? <li>{t("pc", { price: prices.pc, currency })}</li> : null}
          {prices.console ? <li>{t("console", { price: prices.console, currency })}</li> : null}
          {prices.pc || prices.console ? <li>{t("lan")}</li> : <li>{t("noPrices")}</li>}
        </ul>
      </div>
    </section>
  );
}
