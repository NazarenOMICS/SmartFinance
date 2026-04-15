import { expect, test } from "@playwright/test";
import { bootLocalApp, openTab, resetLocalDataset } from "../helpers/local";

test.beforeEach(async ({ request }) => {
  await resetLocalDataset(request);
});

test("accounts, savings, installments y assistant pegan contra backend y persisten", async ({ page }) => {
  await bootLocalApp(page);

  await openTab(page, "accounts");
  await page.getByPlaceholder(/Nombre de la cuenta/i).fill("Caja QA");
  await page.getByRole("combobox").nth(2).selectOption("USD");
  await page.getByPlaceholder(/^Balance$/i).fill("250");
  await page.getByTestId("accounts-create-button").click();
  const createdAccountNameInput = page.getByTestId("account-name-caja_qa");
  await expect(createdAccountNameInput).toHaveValue("Caja QA");

  await createdAccountNameInput.fill("Caja QA Editada");
  await createdAccountNameInput.press("Tab");
  await expect(page.getByTestId("account-name-caja_qa")).toHaveValue("Caja QA Editada");

  await page.getByTestId("account-link-account-a").selectOption("brou_uyu");
  await page.getByTestId("account-link-account-b").selectOption("brou_usd");
  await page.getByTestId("account-links-create-button").click();
  await expect(page.getByTestId("account-links-empty")).toHaveCount(0);
  await expect(page.getByTestId(/account-link-row-/).first()).toContainText("BROU");

  await openTab(page, "savings");
  await page.locator('input[type="number"]').first().fill("60000");
  await page.getByTestId("savings-save-button").click();
  await expect(page.getByText(/Configuraci/i)).toBeVisible();

  await openTab(page, "installments");
  await page.getByPlaceholder(/Descripci/i).fill("Test Cuota");
  await page.getByPlaceholder(/Monto total/i).fill("9000");
  await page.getByPlaceholder(/Cuotas/i).fill("3");
  await page.locator("form").filter({ has: page.getByTestId("installments-create-button") }).getByRole("combobox").selectOption("visa_uyu");
  await page.getByTestId("installments-create-button").click();
  await expect(page.getByText("Test Cuota", { exact: true })).toBeVisible();

  await openTab(page, "assistant");
  await page.getByPlaceholder(/Preguntame/i).fill("Como viene mi mes?");
  await page.getByTestId("assistant-submit-button").click();
  await expect(page.getByText(/Conversacion/i)).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Como viene mi mes?" })).toBeVisible();
});
