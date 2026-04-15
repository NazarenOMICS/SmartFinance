import { expect, test } from "@playwright/test";
import { bootLocalApp, openTab, resetLocalDataset, searchTransaction } from "../helpers/local";

test.beforeEach(async ({ request }) => {
  await resetLocalDataset(request);
});

test("navega tabs principales y carga pantallas sin romper", async ({ page }) => {
  await bootLocalApp(page);

  await openTab(page, "upload");
  await expect(page.getByText(/Paso 1/i)).toBeVisible();

  await openTab(page, "rules");
  await expect(page.getByText(/Categor[ií]as y reglas/i)).toBeVisible();

  await openTab(page, "accounts");
  await expect(page.getByText(/Patrimonio consolidado/i)).toBeVisible();

  await openTab(page, "savings");
  await expect(page.getByText(/Proyecci[oó]n de ahorro/i)).toBeVisible();

  await openTab(page, "recurring");
  await expect(page.getByRole("heading", { name: /Detectados autom[aá]ticamente/i })).toBeVisible();

  await openTab(page, "installments");
  await expect(page.getByText(/Cuotas del mes/i)).toBeVisible();

  await openTab(page, "assistant");
  await expect(page.getByText(/Preguntale al mes/i)).toBeVisible();
});

test("dashboard persiste categorizacion manual y descripcion editada tras recarga", async ({ page }) => {
  await bootLocalApp(page);
  await searchTransaction(page, "MERCADOPAGO FERIA");

  await page.getByRole("button", { name: /Asignar categor/i }).click();
  await page.getByPlaceholder(/Buscar categor/i).fill("Otros");
  await page.getByRole("button", { name: /Otros/i }).first().click();

  const descriptionInput = page.locator('input[value="MERCADOPAGO FERIA"]').first();
  await descriptionInput.click();
  await descriptionInput.fill("Feria barrial");
  await page.keyboard.press("Tab");

  await page.reload();
  await expect(page.getByTestId("tab-dashboard")).toBeVisible();
  await searchTransaction(page, "Feria barrial");
  await expect(page.locator('input[value="Feria barrial"]').first()).toBeVisible();
});
