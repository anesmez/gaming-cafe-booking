import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

/**
 * Milestone 5's "done when": staff run the day from the dashboard on a phone.
 * The owner takes a phone booking, finds it on the calendar, moves it, is
 * stopped from checking it in too early, and cancels it.
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
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Adresse e-mail").fill(OWNER);
  await page.getByRole("button", { name: "Recevoir le code" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(await latestLoginCode(OWNER));
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Tomorrow in Algiers, as YYYY-MM-DD. */
function tomorrow(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("the owner takes a phone booking, moves it and cancels it", async ({ page }) => {
  await logInAsOwner(page);
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByTestId("day-grid")).toBeVisible();

  // A booking taken by phone for tomorrow, on a walk-in PC.
  const date = tomorrow();
  await page.goto(`/admin/bookings/new?date=${date}`);
  await page.getByLabel("Début").selectOption({ label: "18:00" });
  await page.getByRole("checkbox", { name: "PC 07" }).check();
  await page.getByLabel("Nom").fill("Karim (téléphone)");
  await page.getByLabel("Téléphone").fill("0770 11 22 33");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();

  await expect(page.getByText("Réservation enregistrée.")).toBeVisible();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmée");
  const code = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/GC-[A-Z0-9]{4}/)?.[0];
  expect(code).toBeTruthy();
  await expect(page.getByText("PC 07", { exact: true })).toBeVisible();

  // It is on tomorrow's grid; PC 07 at 18:00 is no longer offered.
  await page.goto(`/admin/calendar?date=${date}`);
  await expect(page.getByTestId("day-grid").getByText("Karim (téléphone)")).toBeVisible();
  await page.goto(`/admin/bookings/new?date=${date}`);
  await page.getByLabel("Début").selectOption({ label: "18:00" });
  await expect(page.getByRole("checkbox", { name: "PC 07" })).toBeDisabled();

  // Checking in a day early is refused by the engine, with a clear message.
  await page.goto(`/admin/bookings/${code}`);
  await page.getByRole("button", { name: "Client arrivé" }).click();
  await expect(page.getByText("Trop tôt pour cette action.")).toBeVisible();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmée");

  // Move it one hour later.
  await page.getByRole("link", { name: "Déplacer" }).click();
  await expect(page.getByRole("checkbox", { name: "PC 07" })).toBeChecked();
  await page.getByLabel("Début").selectOption({ label: "19:00" });
  await page.getByRole("button", { name: "Déplacer" }).click();
  await expect(page.getByText("Réservation déplacée.")).toBeVisible();
  await expect(page.getByText(/19:00 – 21:00/)).toBeVisible();

  // Found by phone number, typed differently.
  await page.goto("/admin/bookings?q=0770112233");
  await expect(page.getByRole("link", { name: /Karim/ })).toBeVisible();

  // Cancel: the stations are free again.
  await page.goto(`/admin/bookings/${code}`);
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Réservation annulée. Les postes sont libérés.")).toBeVisible();
  await expect(page.getByTestId("booking-status")).toHaveText("Annulée");
  await page.goto(`/admin/bookings/new?date=${date}`);
  await page.getByLabel("Début").selectOption({ label: "19:00" });
  await expect(page.getByRole("checkbox", { name: "PC 07" })).toBeEnabled();

  // The page fits the phone.
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});
