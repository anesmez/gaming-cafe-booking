import { describe, expect, it } from "vitest";
import { algiers } from "@/lib/booking/fixtures";
import { composeBookingConfirmed, composeLanEmail, composeLoginCode, currencyLabel, type BookingEmailInput } from "./compose";

const venue = {
  venueName: "Respawn Cyber Gaming",
  address: "Villa n°4, Dar El Beïda 16033, Alger",
  timezone: "Africa/Algiers",
  currency: "DZD",
};

describe("composeLoginCode", () => {
  it("puts the code in the subject, the HTML and the plain text", async () => {
    const email = await composeLoginCode({ to: "player@example.com", code: "482913", expiresMinutes: 10, venue });

    expect(email.to).toBe("player@example.com");
    expect(email.subject).toBe("482913 est votre code de connexion Respawn Cyber Gaming");
    expect(email.html).toContain("482913");
    expect(email.html).toContain('lang="fr"');
    expect(email.text).toContain("482913");
    expect(email.text).toContain("10 minutes");
    expect(email.attachments).toBeUndefined();
  });

  it("leaves the address out of the footer when the venue has none", async () => {
    const email = await composeLoginCode({
      to: "player@example.com",
      code: "111111",
      expiresMinutes: 10,
      venue: { venueName: "Respawn Cyber Gaming", address: "" },
    });
    expect(email.text).not.toContain(" · ");
  });
});

describe("composeBookingConfirmed", () => {
  const input: BookingEmailInput = {
    to: "player@example.com",
    booking: {
      code: "GC-7K2F",
      start: algiers("2026-12-02", "18:00"),
      end: algiers("2026-12-02", "20:00"),
      priceEstimate: 800,
      customerName: "Yacine",
    },
    stationNames: ["PC 03", "PC 04"],
    venue,
    graceMinutes: 15,
    cancelCutoffMinutes: 120,
    manageUrl: "https://example.com/booking/GC-7K2F?t=secret-token",
    now: algiers("2026-12-01", "12:00"),
  };

  it("states the code, the stations and the time in the venue's timezone, in French", async () => {
    const email = await composeBookingConfirmed(input);

    expect(email.subject).toBe("Réservation confirmée · GC-7K2F");
    expect(email.text).toContain("Bonjour Yacine");
    expect(email.text).toContain("GC-7K2F");
    expect(email.text).toContain("mercredi 2 décembre 2026");
    expect(email.text).toContain("18:00 – 20:00");
    expect(email.text).toContain("PC 03, PC 04");
    expect(email.text).toContain("800 DA, à régler sur place");
    expect(email.text).toContain("Villa n°4, Dar El Beïda 16033, Alger");
    expect(email.text).toContain("15 minutes");
    expect(email.text).toContain("2 h avant");
  });

  it("links to the manage page", async () => {
    const email = await composeBookingConfirmed(input);
    expect(email.html).toContain('href="https://example.com/booking/GC-7K2F?t=secret-token"');
  });

  it("shows a session after midnight on the calendar date it really starts", async () => {
    const email = await composeBookingConfirmed({
      ...input,
      booking: { ...input.booking, start: algiers("2026-12-03", "00:30"), end: algiers("2026-12-03", "02:00") },
    });
    expect(email.text).toContain("jeudi 3 décembre 2026");
    expect(email.text).toContain("00:30 – 02:00");
  });

  it("does not show a price of zero while prices are not set", async () => {
    const email = await composeBookingConfirmed({ ...input, booking: { ...input.booking, priceEstimate: 0 } });
    expect(email.text).toContain("À régler sur place");
    expect(email.text).not.toContain("0 DA");
  });

  it("escapes whatever the customer typed as their name", async () => {
    const email = await composeBookingConfirmed({
      ...input,
      booking: { ...input.booking, customerName: '<img src=x onerror="alert(1)">' },
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img");
  });

  it("attaches a calendar file for the booked time", async () => {
    const email = await composeBookingConfirmed(input);

    expect(email.attachments).toHaveLength(1);
    const [ics] = email.attachments ?? [];
    expect(ics.filename).toBe("reservation-GC-7K2F.ics");
    expect(ics.contentType).toContain("text/calendar");
    expect(ics.content).toContain("DTSTART:20261202T170000Z");
    expect(ics.content).toContain("DTEND:20261202T190000Z");
    expect(ics.content).toContain("SUMMARY:Respawn Cyber Gaming · PC 03\\, PC 04");
  });
});

describe("currencyLabel", () => {
  it("writes Algerian dinars the local way", () => {
    expect(currencyLabel("DZD")).toBe("DA");
    expect(currencyLabel("EUR")).toBe("EUR");
  });
});

describe("composeLanEmail", () => {
  const input = {
    to: "owner@example.com",
    booking: {
      code: "GC-LAN1",
      start: algiers("2026-12-04", "18:00"),
      end: algiers("2026-12-04", "22:00"),
      customerName: "Team Raptors",
      customerPhone: "0550 11 22 33",
      partySize: 12,
      notes: "Tournoi Valorant",
    },
    venue,
    url: "https://example.com/admin/requests",
    deadline: algiers("2026-12-02", "12:00"),
  };

  it("gives the owner the group, the contact, the deadline and a link to answer", async () => {
    const email = await composeLanEmail("owner", input);
    expect(email.subject).toBe("Nouvelle demande de LAN · vendredi 4 décembre");
    for (const text of ["Team Raptors", "0550 11 22 33", "12 personnes", "Tournoi Valorant", "18:00 – 22:00", "mercredi 2 décembre à 12:00"]) {
      expect(email.text).toContain(text);
    }
    expect(email.html).toContain('href="https://example.com/admin/requests"');
  });

  it("does not show the customer's own contact back to them", async () => {
    const email = await composeLanEmail("requested", { ...input, to: "raptors@example.com", approvalTimeoutHours: 24 });
    expect(email.subject).toBe("Demande de LAN reçue · GC-LAN1");
    expect(email.text).toContain("24 h");
    expect(email.text).not.toContain("0550 11 22 33");
  });

  it("states the agreed price and the owner's note on approval", async () => {
    const email = await composeLanEmail("approved", {
      ...input,
      booking: { ...input.booking, quotedPrice: 15000 },
      ownerNote: "Clavier perso autorisé",
    });
    expect(email.subject).toBe("LAN confirmée · GC-LAN1");
    expect(email.text).toContain("15000 DA");
    expect(email.text).toContain("Clavier perso autorisé");
  });

  it("says plainly when the request is refused", async () => {
    const email = await composeLanEmail("rejected", input);
    expect(email.subject).toBe("Demande de LAN refusée · GC-LAN1");
    expect(email.text).toContain("libérée");
  });
});
