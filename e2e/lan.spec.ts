import { readFile } from "node:fs/promises";
import { devices, expect, test, type Page } from "@playwright/test";

/**
 * Milestone 6 end to end, on a phone: a group requests the whole venue, the
 * request holds the slots, the owner approves it with a price, the customer
 * is told by email.
 */

const CUSTOMER = "raptors@example.com";
const OWNER = "owner@example.com";

async function outbox(): Promise<{ to: string; subject: string; text: string }[]> {
  const content = await readFile(process.env.E2E_OUTBOX_FILE!, "utf8").catch(() => "");
  return content.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function logIn(page: Page, email: string, from: string) {
  await page.goto(from);
  await expect(page).toHaveURL(/\/login\?next=|\/book\/lan$/);
  if (page.url().includes("/book/lan")) {
    await page.getByRole("link", { name: "Recevoir mon code" }).click();
  }
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir le code" }).click();
  let code: string | undefined;
  await expect
    .poll(async () => {
      code = (await outbox()).filter((m) => m.to === email && /\b\d{6}\b/.test(m.subject)).at(-1)?.subject.match(/\b(\d{6})\b/)?.[1];
      return code;
    })
    .toBeTruthy();
  await page.getByLabel("Code à 6 chiffres").fill(code!);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Algiers date in `days` days, YYYY-MM-DD. */
function inDays(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("a group requests a LAN and the owner approves it", async ({ page, browser }) => {
  // Customer: from the booking page to the LAN request.
  await logIn(page, CUSTOMER, "/book/lan");
  await expect(page).toHaveURL(/\/book\/lan$/);
  await expect(page.getByRole("heading", { name: "Demande de LAN" })).toBeVisible();

  await page.getByLabel("Quel jour ?").fill(inDays(4));
  const times = page.getByRole("radiogroup", { name: "À quelle heure ?" }).getByRole("radio");
  await expect(times.first()).toBeVisible();
  await times.first().click();
  await page.getByLabel("Nombre de joueurs").fill("12");
  await page.getByLabel("Nom", { exact: true }).fill("Team Raptors");
  await page.getByLabel("Téléphone").fill("0550 11 22 33");
  await page.getByLabel(/Votre message/).fill("Tournoi Valorant");
  await page.getByRole("button", { name: "Envoyer la demande" }).click();

  await expect(page).toHaveURL(/\/booking\/GC-[A-Z0-9]{4}\?t=/);
  await expect(page.getByTestId("booking-status")).toHaveText("En attente de validation");
  await expect(page.getByText("La salle est bloquée pour vous")).toBeVisible();
  const code = (await page.getByTestId("booking-code").textContent())?.trim();

  // Both emails went out.
  await expect.poll(async () => (await outbox()).some((m) => m.to === CUSTOMER && m.subject.includes("Demande de LAN reçue"))).toBe(true);
  await expect.poll(async () => (await outbox()).some((m) => m.to === OWNER && m.subject.startsWith("Nouvelle demande de LAN"))).toBe(true);

  // Owner, on another phone: sees the request and approves it with a price.
  const ownerContext = await browser.newContext({ ...devices["Pixel 7"] });
  const ownerPage = await ownerContext.newPage();
  await logIn(ownerPage, OWNER, "/admin/requests");
  await expect(ownerPage).toHaveURL(/\/admin\/requests$/);
  const card = ownerPage.getByTestId("lan-request").filter({ hasText: code! });
  await expect(card).toContainText("Team Raptors");
  await expect(card).toContainText("12 personnes");
  await card.getByLabel("Prix convenu (DA)").fill("15000");
  await card.getByRole("button", { name: "Accepter" }).click();
  await expect(ownerPage.getByText("Demande acceptée.")).toBeVisible();
  await expect(ownerPage.getByTestId("lan-request").filter({ hasText: code! })).toHaveCount(0);
  await ownerContext.close();

  // Customer: confirmed, with the price; told by email.
  await page.reload();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmée");
  await expect(page.getByText("15000 DA, à régler sur place")).toBeVisible();
  await expect.poll(async () => (await outbox()).some((m) => m.to === CUSTOMER && m.subject === `LAN confirmée · ${code}`)).toBe(true);
});
