import { getRequestConfig } from "next-intl/server";

/**
 * French only for now, with no locale routing. To add Arabic or English:
 * add messages/<locale>.json and resolve the locale here (cookie or URL prefix).
 */
export const DEFAULT_LOCALE = "fr";

/**
 * Dates are formatted in the venue timezone, never the server's. Hard-coded to
 * the seed default until settings are loaded per request (milestone 4).
 */
export const DEFAULT_TIME_ZONE = "Africa/Algiers";

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    timeZone: DEFAULT_TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
