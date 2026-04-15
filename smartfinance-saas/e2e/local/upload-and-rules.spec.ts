import { expect, test } from "@playwright/test";
import { bootLocalApp, openTab, resetLocalDataset } from "../helpers/local";

test.beforeEach(async ({ request }) => {
  await resetLocalDataset(request);
});

test("upload panel importa via mapper/paste, muestra historial y permite carga manual", async ({ page }) => {
  await bootLocalApp(page);
  await openTab(page, "upload");

  await page.getByText(/Paso 2a/i).first().scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /BROU Caja UYU/i }).click();

  const seededHistoryCard = page
    .locator('[data-testid^="upload-history-"]')
    .filter({ hasText: "abril-seed.csv" })
    .first();
  await seededHistoryCard.scrollIntoViewIfNeeded();
  await expect(seededHistoryCard).toBeVisible();

  await page.getByText(/Paso 2c/i).first().scrollIntoViewIfNeeded();
  await page.locator("textarea").fill([
    "fecha,descripcion,monto",
    "2026-04-15,DISCO TEST,-2500",
    "2026-04-16,GYM CLUB,-1700",
  ].join("\n"));
  await page.getByRole("button", { name: /Analizar datos/i }).click();
  await page.getByRole("button", { name: /Importar 2 transacciones/i }).click();
  await expect(page.getByText(/Importaci/i)).toBeVisible();

  await expect(page.getByText(/Revision individual/i)).toBeVisible();
  await page.getByRole("button", { name: "x" }).click();

  await openTab(page, "upload");
  await page.getByRole("button", { name: /BROU Caja UYU/i }).click();
  await page.getByText(/Paso 2b/i).first().scrollIntoViewIfNeeded();
  await page.getByRole("textbox", { name: /Descripción \(obligatoria\)/i }).fill("Compra kioskito");
  const amountInput = page.locator('input[placeholder="Monto"]').first();
  await amountInput.scrollIntoViewIfNeeded();
  await amountInput.fill("450");
  await page.getByTestId("manual-transaction-submit").scrollIntoViewIfNeeded();
  await page.getByTestId("manual-transaction-submit").click();

  await openTab(page, "dashboard");
  await page.getByPlaceholder(/Buscar/i).fill("Compra kioskito");
  await expect(page.locator('input[value="Compra kioskito"]').first()).toBeVisible();
});

test("upload directo usa backend nativo y parsea texto extraido", async ({ page, request }) => {
  await request.post("http://127.0.0.1:8787/api/accounts", {
    data: {
      id: "direct_upload_uyu",
      name: "Direct Upload UYU",
      currency: "UYU",
      balance: 0,
      opening_balance: 0,
    },
  });

  await bootLocalApp(page);
  await openTab(page, "upload");

  await page.getByText(/Paso 2a/i).first().scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /Direct Upload UYU/i }).click();

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "movimientos-directos.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("20/04 PEDIDOSYA DIRECTO -890\n21/04 NETFLIX DIRECTO -429", "utf8"),
  });
  const [uploadResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/upload") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: /Procesar/i }).click(),
  ]);
  expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);

  await expect(page.getByText(/Nuevas:\s*2/i)).toBeVisible();
  await expect(page.getByText(/Parser: Texto/i)).toBeVisible();
  await expect(page.getByText(/Formato: generic_text/i)).toBeVisible();

  await openTab(page, "dashboard");
  await page.getByPlaceholder(/Buscar/i).fill("PEDIDOSYA DIRECTO");
  await expect(page.locator('input[value="PEDIDOSYA DIRECTO"]').first()).toBeVisible();
});

test("upload bloquea archivo con moneda distinta a la cuenta elegida", async ({ page, request }) => {
  await request.post("http://127.0.0.1:8787/api/accounts", {
    data: {
      id: "guard_uyu",
      name: "Guard Test UYU",
      currency: "UYU",
      balance: 0,
      opening_balance: 0,
    },
  });

  await bootLocalApp(page);
  await openTab(page, "upload");

  await page.getByText(/Paso 2a/i).first().scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /Guard Test UYU/i }).click();

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "movimientos-usd-en-cuenta-uyu.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([
      "Cliente,Persona Test,",
      "Cuenta,Ca Universitaria Basica,",
      "Moneda,USD,",
      "",
      "Movimientos,",
      "Fecha,Referencia,Concepto,Descripcion,Debito,Credito,Saldos,",
      "26/03/2026,550069,DEBITO OPERACION EN SUPERNET,,800.00,,1.89,",
    ].join("\n"), "utf8"),
  });

  const [uploadResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/upload") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: /Procesar/i }).click(),
  ]);
  expect(uploadResponse.status()).toBe(409);
  await expect(page.getByText(/cuenta seleccionada es UYU.*archivo parece ser USD/i)).toBeVisible();
});

test("rules permite crear y borrar regla manual", async ({ page }) => {
  await bootLocalApp(page);
  await openTab(page, "rules");

  await page.getByPlaceholder(/Patron/i).fill("APP TEST RULE");
  await page
    .locator("form")
    .filter({ has: page.getByTestId("rules-create-button") })
    .getByRole("combobox")
    .first()
    .selectOption({ label: "Otros" });
  await page.getByTestId("rules-create-button").click();

  await expect(page.getByText("APP TEST RULE")).toBeVisible();

  const deleteButton = page.getByTestId(/rule-delete-/).first();
  await deleteButton.click();
  await deleteButton.click();
  await expect(page.getByText("APP TEST RULE")).toHaveCount(0);
});
