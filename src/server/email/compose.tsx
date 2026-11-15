import { render, toPlainText } from "@react-email/render";
import { fr } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { createTranslator } from "next-intl";
import { buildIcs } from "@/lib/booking/ics";
import messages from "../../../messages/fr.json";
import { BookingConfirmedEmail } from "./templates/booking-confirmed";
import { LoginCodeEmail } from "./templates/login-code";
import { NoticeEmail } from "./templates/notice";
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

export interface LanEmailInput {
  to: string;
  booking: {
    code: string;
    start: Date;
    end: Date;
    customerName: string;
    customerPhone: string;
    partySize?: number;
    notes?: string;
    quotedPrice?: number;
  };
  venue: VenueInfo;
  url: string;
  approvalTimeoutHours?: number;
  deadline?: Date;
  ownerNote?: string;
}

function lanRows(input: LanEmailInput, withCustomer: boolean) {
  const { booking, venue } = input;
  const at = (d: Date, p: string) => formatInTimeZone(d, venue.timezone, p, { locale: fr });
  return [
    { label: t("lan.date"), value: at(booking.start, "EEEE d MMMM yyyy") },
    { label: t("lan.time"), value: `${at(booking.start, "HH:mm")} – ${at(booking.end, "HH:mm")}` },
    ...(booking.partySize ? [{ label: t("lan.group"), value: t("lan.groupValue", { count: booking.partySize }) }] : []),
    ...(withCustomer
      ? [
          { label: t("lan.customer"), value: booking.customerName },
          { label: t("lan.phone"), value: booking.customerPhone },
          ...(booking.notes ? [{ label: t("lan.notes"), value: booking.notes }] : []),
        ]
      : []),
    ...(booking.quotedPrice
      ? [
          {
            label: t("lan.price"),
            value: t("lan.priceValue", { amount: booking.quotedPrice, currency: currencyLabel(venue.currency) }),
          },
        ]
      : []),
  ];
}

export type LanEmailKind = "requested" | "owner" | "approved" | "rejected";

export function composeLanEmail(kind: LanEmailKind, input: LanEmailInput): Promise<EmailMessage> {
  const { booking, venue } = input;
  const name = booking.customerName;
  const note = input.ownerNote ? t("lan.ownerNote", { note: input.ownerNote }) : undefined;

  const content: Record<LanEmailKind, () => { subject: string; heading: string; paragraphs: string[]; button?: { label: string; href: string }; withCustomer: boolean; note?: string }> = {
    requested: () => ({
      subject: t("lan.requested.subject", { code: booking.code }),
      heading: t("lan.requested.heading"),
      paragraphs: [
        t("lan.requested.intro", { name }),
        t("lan.requested.wait", { hours: input.approvalTimeoutHours ?? 24 }),
      ],
      button: { label: t("lan.manage"), href: input.url },
      withCustomer: false,
    }),
    owner: () => ({
      subject: t("lan.owner.subject", {
        date: formatInTimeZone(booking.start, venue.timezone, "EEEE d MMMM", { locale: fr }),
      }),
      heading: t("lan.owner.heading"),
      paragraphs: [
        t("lan.owner.intro", { name }),
        ...(input.deadline
          ? [
              t("lan.owner.deadline", {
                deadline: formatInTimeZone(input.deadline, venue.timezone, "EEEE d MMMM 'à' HH:mm", { locale: fr }),
              }),
            ]
          : []),
      ],
      button: { label: t("lan.owner.open"), href: input.url },
      withCustomer: true,
    }),
    approved: () => ({
      subject: t("lan.approved.subject", { code: booking.code }),
      heading: t("lan.approved.heading"),
      paragraphs: [t("lan.approved.intro", { name, code: booking.code })],
      button: { label: t("lan.manage"), href: input.url },
      withCustomer: false,
      note,
    }),
    rejected: () => ({
      subject: t("lan.rejected.subject", { code: booking.code }),
      heading: t("lan.rejected.heading"),
      paragraphs: [t("lan.rejected.intro", { name }), t("lan.rejected.other")],
      withCustomer: false,
      note,
    }),
  };

  const c = content[kind]();
  return toMessage(
    input.to,
    c.subject,
    <NoticeEmail
      lang={LOCALE}
      venueName={venue.venueName}
      title={c.subject}
      heading={c.heading}
      paragraphs={c.paragraphs}
      rows={lanRows(input, c.withCustomer)}
      button={c.button}
      note={c.note}
      footer={footer(venue)}
    />,
  );
}

// ---------------------------------------------------------------------------
// Reminders, changes, expiries and the owner's daily summary
// ---------------------------------------------------------------------------

export interface SimpleBooking {
  code: string;
  type: "station" | "venue" | "block";
  start: Date;
  end: Date;
  customerName: string;
}

function when(d: Date, venue: VenueInfo, p = "EEEE d MMMM 'à' HH:mm") {
  return formatInTimeZone(d, venue.timezone, p, { locale: fr });
}

function bookingRows(booking: SimpleBooking, venue: VenueInfo, stationNames: string[]) {
  return [
    { label: t("common.date"), value: when(booking.start, venue, "EEEE d MMMM yyyy") },
    {
      label: t("common.time"),
      value: t("common.timeValue", { start: when(booking.start, venue, "HH:mm"), end: when(booking.end, venue, "HH:mm") }),
    },
    ...(stationNames.length > 0 && booking.type !== "venue" ? [{ label: t("common.stations"), value: stationNames.join(", ") }] : []),
    { label: t("common.code"), value: booking.code },
  ];
}

function notice(
  to: string,
  venue: VenueInfo,
  c: { subject: string; heading: string; paragraphs: string[]; rows?: { label: string; value: string }[]; button?: { label: string; href: string }; note?: string },
) {
  return toMessage(
    to,
    c.subject,
    <NoticeEmail
      lang={LOCALE}
      venueName={venue.venueName}
      title={c.subject}
      heading={c.heading}
      paragraphs={c.paragraphs}
      rows={c.rows}
      button={c.button}
      note={c.note}
      footer={footer(venue)}
    />,
  );
}

export function composeReminder(input: {
  to: string;
  booking: SimpleBooking;
  stationNames: string[];
  venue: VenueInfo;
  graceMinutes: number;
  url: string;
}): Promise<EmailMessage> {
  const { booking, venue } = input;
  const at = when(booking.start, venue);
  const values = { name: booking.customerName, when: at, code: booking.code };
  return notice(input.to, venue, {
    subject: t("reminder.subject", { code: booking.code, when: at }),
    heading: t("reminder.heading"),
    paragraphs: [
      booking.type === "venue" ? t("reminder.introLan", values) : t("reminder.intro", values),
      ...(booking.type === "venue" ? [] : [t("reminder.arrival", { minutes: input.graceMinutes })]),
    ],
    rows: bookingRows(booking, venue, input.stationNames),
    button: { label: t("common.manage"), href: input.url },
    note: t("reminder.change"),
  });
}

export function composeBookingChanged(
  kind: "cancelled" | "moved" | "team",
  input: {
    to: string;
    booking: SimpleBooking;
    stationNames: string[];
    venue: VenueInfo;
    url: string;
    /** cancelled: who cancelled. */
    byCustomer?: boolean;
    /** moved: the previous start and end. */
    previous?: { start: Date; end: Date };
  },
): Promise<EmailMessage> {
  const { booking, venue } = input;
  const date = when(booking.start, venue);
  const name = booking.customerName;
  if (kind === "cancelled") {
    return notice(input.to, venue, {
      subject: t("changed.cancelled.subject", { code: booking.code }),
      heading: t("changed.cancelled.heading"),
      paragraphs: [input.byCustomer ? t("changed.cancelled.byCustomer", { name, date }) : t("changed.cancelled.byCafe", { name, date })],
      button: { label: t("common.bookAgain"), href: input.url },
    });
  }
  if (kind === "moved") {
    const old = input.previous
      ? `${when(input.previous.start, venue)} – ${when(input.previous.end, venue, "HH:mm")}`
      : "";
    return notice(input.to, venue, {
      subject: t("changed.moved.subject", { code: booking.code }),
      heading: t("changed.moved.heading"),
      paragraphs: [t("changed.moved.intro", { name })],
      rows: bookingRows(booking, venue, input.stationNames),
      button: { label: t("common.manage"), href: input.url },
      ...(old ? { note: t("changed.moved.before", { old }) } : {}),
    });
  }
  return notice(input.to, venue, {
    subject: t("changed.team.subject", { code: booking.code }),
    heading: t("changed.team.heading"),
    paragraphs: [t("changed.team.intro", { name, code: booking.code, date })],
    rows: bookingRows(booking, venue, input.stationNames),
    button: { label: t("changed.team.open"), href: input.url },
  });
}

export function composeLanExpired(input: { to: string; booking: SimpleBooking; venue: VenueInfo; url: string }): Promise<EmailMessage> {
  const { booking, venue } = input;
  return notice(input.to, venue, {
    subject: t("lanExpired.subject", { code: booking.code }),
    heading: t("lanExpired.heading"),
    paragraphs: [t("lanExpired.intro", { name: booking.customerName, date: when(booking.start, venue) }), t("lanExpired.other")],
    button: { label: t("lanExpired.again"), href: input.url },
  });
}

export function composeDailySummary(input: {
  to: string;
  date: Date;
  open: boolean;
  venue: VenueInfo;
  bookings: (SimpleBooking & { stationNames: string[] })[];
  pendingRequests: number;
  url: string;
}): Promise<EmailMessage> {
  const { venue } = input;
  return notice(input.to, venue, {
    subject: t("summary.subject", { date: when(input.date, venue, "EEEE d MMMM") }),
    heading: t("summary.heading"),
    paragraphs: [
      input.open ? t("summary.count", { count: input.bookings.length }) : t("summary.closed"),
      ...(input.pendingRequests > 0 ? [t("summary.pending", { count: input.pendingRequests })] : []),
    ],
    rows: input.bookings.map((b) => ({
      label: t("common.timeValue", { start: when(b.start, venue, "HH:mm"), end: when(b.end, venue, "HH:mm") }),
      value: t("summary.row", {
        name: b.customerName,
        stations: b.type === "venue" ? t("summary.lan") : b.stationNames.join(", "),
        code: b.code,
      }),
    })),
    button: input.pendingRequests > 0 ? { label: t("summary.requests"), href: `${input.url}/requests` } : { label: t("summary.open"), href: input.url },
  });
}
