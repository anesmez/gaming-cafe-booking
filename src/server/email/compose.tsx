import { render, toPlainText } from "@react-email/render";
import { fr } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { createTranslator } from "next-intl";
import { buildIcs } from "@/lib/booking/ics";
import messages from "../../../messages/fr.json";
import { BookingConfirmedEmail } from "./templates/booking-confirmed";
import { LoginCodeEmail } from "./templates/login-code";
import type { EmailMessage } from "./transport";

/**
 * Turns data into a ready-to-send email. No database access and no sending:
 * everything here can be rendered and checked in a unit test.
 * All copy comes from messages/fr.json.
 */

const LOCALE = "fr";
const t = createTranslator({ locale: LOCALE, messages, namespace: "email" });

export interface VenueInfo {
  venueName: string;
  address: string;
  timezone: string;
  currency: string;
}

function footer(venue: VenueInfo): string {
  return venue.address
    ? t("footer", { venue: venue.venueName, address: venue.address })
    : t("footerNoAddress", { venue: venue.venueName });
}

async function toMessage(to: string, subject: string, element: React.ReactElement): Promise<EmailMessage> {
  const html = await render(element);
  return { to, subject, html, text: toPlainText(html) };
}

export function composeLoginCode(input: {
  to: string;
  code: string;
  expiresMinutes: number;
  venue: Pick<VenueInfo, "venueName" | "address">;
}): Promise<EmailMessage> {
  const venue = { ...input.venue, timezone: "", currency: "" };
  const copy = {
    subject: t("loginCode.subject", { code: input.code, venue: venue.venueName }),
    heading: t("loginCode.heading"),
    intro: t("loginCode.intro"),
    validity: t("loginCode.validity", { minutes: input.expiresMinutes }),
    ignore: t("loginCode.ignore"),
    footer: footer(venue),
  };
  return toMessage(
    input.to,
    copy.subject,
    <LoginCodeEmail lang={LOCALE} venueName={venue.venueName} code={input.code} copy={copy} />,
  );
}

export interface BookingEmailInput {
  to: string;
  booking: {
    code: string;
    start: Date;
    end: Date;
    priceEstimate: number;
    customerName: string;
  };
  /** Station names in floor order, e.g. ["PC 03", "PC 04"]. */
  stationNames: string[];
  venue: VenueInfo;
  graceMinutes: number;
  cancelCutoffMinutes: number;
  manageUrl: string;
  /** Generation time of the calendar file. */
  now: Date;
}

/** Display form of a currency code. Algerians write dinars as "DA". */
export function currencyLabel(currency: string): string {
  return currency === "DZD" ? "DA" : currency;
}

export async function composeBookingConfirmed(input: BookingEmailInput): Promise<EmailMessage> {
  const { booking, venue } = input;
  const inVenueTime = (date: Date, pattern: string) =>
    formatInTimeZone(date, venue.timezone, pattern, { locale: fr });

  const stations = input.stationNames.join(", ");
  const price =
    booking.priceEstimate > 0
      ? t("bookingConfirmed.priceValue", {
          amount: booking.priceEstimate,
          currency: currencyLabel(venue.currency),
        })
      : t("bookingConfirmed.priceOnSite");

  const rows = [
    { label: t("bookingConfirmed.date"), value: inVenueTime(booking.start, "EEEE d MMMM yyyy") },
    {
      label: t("bookingConfirmed.time"),
      value: t("bookingConfirmed.timeValue", {
        start: inVenueTime(booking.start, "HH:mm"),
        end: inVenueTime(booking.end, "HH:mm"),
      }),
    },
    { label: t("bookingConfirmed.stations"), value: stations },
    { label: t("bookingConfirmed.price"), value: price },
    ...(venue.address ? [{ label: t("bookingConfirmed.address"), value: venue.address }] : []),
  ];

  const copy = {
    subject: t("bookingConfirmed.subject", { code: booking.code }),
    heading: t("bookingConfirmed.heading"),
    intro: t("bookingConfirmed.intro", { name: booking.customerName }),
    codeLabel: t("bookingConfirmed.codeLabel"),
    manage: t("bookingConfirmed.manage"),
    arrival: t("bookingConfirmed.arrival", { minutes: input.graceMinutes }),
    cancellation: t("bookingConfirmed.cancellation", { hours: input.cancelCutoffMinutes / 60 }),
    footer: footer(venue),
  };

  const message = await toMessage(
    input.to,
    copy.subject,
    <BookingConfirmedEmail
      lang={LOCALE}
      venueName={venue.venueName}
      code={booking.code}
      manageUrl={input.manageUrl}
      rows={rows}
      copy={copy}
    />,
  );

  return {
    ...message,
    attachments: [
      {
        filename: `reservation-${booking.code}.ics`,
        contentType: "text/calendar; charset=utf-8",
        content: buildIcs({
          uid: booking.code,
          start: booking.start,
          end: booking.end,
          summary: t("bookingConfirmed.calendarSummary", { venue: venue.venueName, stations }),
          description: t("bookingConfirmed.calendarDescription", { code: booking.code }),
          location: venue.address || undefined,
          now: input.now,
        }),
      },
    ],
  };
}
