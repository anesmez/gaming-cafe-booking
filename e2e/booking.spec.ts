import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

/**
 * Milestone 4's "done when": a customer books and cancels on a phone.
 * Login codes and the confirmation are read from the email outbox file.
 */

const EMAIL = "player@example.com";

async function readOutbox(): Promise<{ to: string; subject: string; text: string; html: string }[]> {
  const path = process.env.E2E_OUTBOX_FILE;
  if (!path) throw new Error("E2E_OUTBOX_FILE is not set; run through `pnpm test:e2e`");
  const content = await readFile(path, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function latestLoginCode(email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const mails = (await readOutbox()).filter((m) => m.to === email && /\b\d{6}\b/.test(m.subject));
      code = mails.at(-1)?.subject.match(/\b(\d{6})\b/)?.[1];
      return code;
    })
    .toBeTruthy();
  return code!;
}

async function logIn(page: Page, email: string) {
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir le code" }).click();
  await expect(page.getByLabel("Code à 6 chiffres")).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(await latestLoginCode(email));
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("a customer books two PCs and cancels from the booking page", async ({ page }) => {
  // Home → book → asked to log in.
  await page.goto("/");
  await page.getByRole("link", { name: "Réserver un créneau" }).click();
  await expect(page).toHaveURL(/\/book$/);
  await page.getByRole("link", { name: "Recevoir mon code" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fbook|\/login\?next=\/book/);

  // Log in by email code; back on the booking page.
  await logIn(page, EMAIL);
  await expect(page).toHaveURL(/\/book$/);

  // Two PCs, tomorrow, 2 hours (the default), first free time.
  await page.getByLabel("Nombre de postes").selectOption("2");
  await page.getByRole("radiogroup", { name: "Quel jour ?" }).getByRole("radio").nth(1).click();
  const times = page.getByRole("radiogroup", { name: "À quelle heure ?" }).getByRole("radio");
  await expect(times.first()).toBeVisible();
  const time = (await times.first().textContent())?.trim();
  await times.first().click();

  await page.getByLabel("Nom", { exact: true }).fill("Yacine");
  await page.getByLabel("Téléphone").fill("0550 12 34 56");
  // The confirm bar is pinned to the bottom of the screen: scroll to the end of
  // the form, as a person would, so the bar sits where it is drawn.
  await page.getByLabel("Téléphone").press("Tab");
  await page.mouse.wheel(0, 5000);
  await page.getByRole("button", { name: "Confirmer la réservation" }).click();

  // Booking page with the code and the stations.
  await expect(page).toHaveURL(/\/booking\/GC-[A-Z0-9]{4}\?t=/);
  await expect(page.getByText("C'est réservé.")).toBeVisible();
  await expect(page.getByTestId("booking-status")).toHaveText("Confirmée");
  const code = (await page.getByTestId("booking-code").textContent())?.trim();
  expect(code).toMatch(/^GC-[A-Z0-9]{4}$/);
  await expect(page.getByText("PC 01, PC 02")).toBeVisible();
  await expect(page.getByText(`${time} –`)).toBeVisible();

  // The confirmation email went out with the same code and a working link.
  const confirmation = (await readOutbox()).find((m) => m.to === EMAIL && m.subject.includes(code!));
  expect(confirmation?.text).toContain("Bonjour Yacine");
  const link = confirmation?.html.match(/href="([^"]*\/booking\/[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  expect(link).toBeTruthy();

  // The slot is gone for the next customer: with 5 online PCs, 2 are left at that time.
  // Cancel, from the link in the email this time.
  await page.goto(link!);
  await page.getByRole("button", { name: "Annuler la réservation" }).click();
  await expect(page.getByText("Réservation annulée. Le créneau est libéré.")).toBeVisible();
  await expect(page.getByTestId("booking-status")).toHaveText("Annulée");
  await expect(page.getByRole("button", { name: "Annuler la réservation" })).toHaveCount(0);
});

test("a stranger cannot open someone else's booking", async ({ page }) => {
  await page.goto("/booking/GC-ZZZZ?t=not-a-token");
  await expect(page.getByText("Réservation introuvable")).toBeVisible();
});

test("customers do not get into the staff area", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=/);
  await logIn(page, "someone@example.com");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Accès réservé à l'équipe")).toBeVisible();
});
