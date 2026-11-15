import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

/**
 * Milestone 7's "done when": the owner changes the defaults from a phone,
 * without a deploy. A rule, a closure, a station and a staff account.
 */

const OWNER = "owner@example.com";

async function latestLoginCode(email: string): Promise<string> {
  const path = process.env.E2E_OUTBOX_FILE!;
  let code: string | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(path, "utf8").catch(() => "")).split("\n").filter(Boolean);
      const mails = lines.map((l) => JSON.parse(l)).filter((m) => m.to === email && /\b\d{6}\b/.test(m.subject));
      code = mails.at(-1)?.subject.match(/\b(\d{6})\b/)?.[1];
      return code;
    })
    .toBeTruthy();
  return code!;
}

async function logInAsOwner(page: Page) {
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Adresse e-mail").fill(OWNER);
  await page.getByRole("button", { name: "Recevoir le code" }).click();
  await expect(page.getByLabel("Code à 6 chiffres")).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(await latestLoginCode(OWNER));
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
}

/** A date in Algiers, `days` from today, as YYYY-MM-DD. */
function inDays(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function freeSlots(page: Page, date: string): Promise<number> {
  const res = await page.request.get(`/api/availability?date=${date}&type=pc`);
  const body = (await res.json()) as { resources: { free: boolean[] }[] };
  return body.resources.flatMap((r) => r.free).filter(Boolean).length;
}

test("the owner changes rules, closes a day, adds a station and a staff member", async ({ page }) => {
  await logInAsOwner(page);
  const main = page;

  // A rule: a bad value is refused and keeps what was typed, a good one sticks.
  const limit = main.getByLabel("Absences avant blocage en ligne");
  await expect(limit).toHaveValue("3");
  await main.getByLabel("Durée maximum (heures)").first().fill("0.5");
  await limit.fill("4");
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(main.getByRole("alert")).toContainText("À corriger");
  await expect(main.getByText("Le maximum est plus petit que le minimum.")).toBeVisible();
  await expect(main.getByLabel("Absences avant blocage en ligne")).toHaveValue("4");
  await main.getByLabel("Durée maximum (heures)").first().fill("6");
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(main.getByRole("status")).toHaveText("Réglages enregistrés.");
  await page.reload();
  await expect(page.getByLabel("Absences avant blocage en ligne")).toHaveValue("4");

  // A closure takes the whole day off the public calendar, and comes off again.
  const date = inDays(10);
  expect(await freeSlots(page, date)).toBeGreaterThan(0);
  await page.goto("/admin/settings/closures");
  await page.getByLabel("Du").fill(date);
  await page.getByLabel("Au (inclus)").fill(date);
  await page.getByLabel("Motif").fill("Inventaire");
  await page.getByRole("button", { name: "Fermer ces jours" }).click();
  await expect(page.getByRole("status")).toHaveText("Fermeture enregistrée.");
  await expect(page.getByTestId("closure").filter({ hasText: "Inventaire" })).toContainText("Toute la salle");
  expect(await freeSlots(page, date)).toBe(0);
  await page.getByTestId("closure").filter({ hasText: "Inventaire" }).getByRole("button", { name: "Rouvrir" }).click();
  await expect(page.getByRole("status")).toHaveText("Ces jours sont de nouveau ouverts.");
  expect(await freeSlots(page, date)).toBeGreaterThan(0);

  // A station, added walk-in only, then switched off.
  await page.goto("/admin/stations");
  await page.getByLabel("Nom", { exact: true }).last().fill("PC 11");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Poste ajouté.");
  const pc11 = page.getByTestId("station").filter({ has: page.locator('input[value="PC 11"]') });
  await pc11.getByLabel("Actif").uncheck();
  await pc11.getByRole("button", { name: "Enregistrer PC 11" }).click();
  await expect(page.getByRole("status")).toHaveText("Poste enregistré.");

  // A price shows on the home page straight away.
  const ps5 = page.getByTestId("station").filter({ has: page.locator('input[value="PS5"]') });
  await ps5.getByLabel(/Prix de l'heure/).fill("300");
  await ps5.getByRole("button", { name: "Enregistrer PS5" }).click();
  await expect(page.getByRole("status")).toHaveText("Poste enregistré.");
  await page.goto("/");
  await expect(page.getByText("PS5 : 300 DA l'heure")).toBeVisible();
  await expect(page.getByTestId("opening-hours")).toContainText(/Lundi\s*\d{2}:\d{2} – \d{2}:\d{2}/);

  // A staff account.
  await page.goto("/admin/settings/team");
  await page.getByLabel("Adresse e-mail").fill("comptoir@example.com");
  await page.getByRole("button", { name: "Ajouter à l'équipe" }).click();
  await expect(page.getByRole("status")).toContainText("Ajouté à l'équipe");
  await expect(page.getByTestId("team-member").filter({ hasText: "comptoir@example.com" })).toContainText("Équipe");

  // The customer list is there for the counter.
  await page.goto("/admin/customers");
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByText(/après 4 absences/)).toBeVisible();

  // Everything fits a phone screen.
  for (const path of ["/admin/settings", "/admin/settings/closures", "/admin/stations", "/admin/settings/team", "/admin/customers"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
