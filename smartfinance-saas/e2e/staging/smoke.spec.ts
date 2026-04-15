import { expect, test } from "@playwright/test";

const remoteApiUrl =
  process.env.E2E_STAGING_API_URL ||
  "https://smartfinance-saas-api-production.nazarenocabrerati.workers.dev";
const remoteWebUrl =
  process.env.E2E_STAGING_WEB_URL ||
  "https://smartfinance-saas-web.pages.dev";
const remoteToken = process.env.E2E_STAGING_BEARER_TOKEN;

test("@staging-api api smoke verifica publico, schema y auth protegida", async ({ request }) => {
  const health = await request.get(`${remoteApiUrl}/api/health`);
  expect(health.ok()).toBeTruthy();

  const schema = await request.get(`${remoteApiUrl}/api/system/schema`);
  expect(schema.ok()).toBeTruthy();

  const protectedAccounts = await request.get(`${remoteApiUrl}/api/accounts`);
  expect(protectedAccounts.status()).toBe(401);

  const protectedSummary = await request.get(`${remoteApiUrl}/api/transactions/summary?month=2026-04`);
  expect(protectedSummary.status()).toBe(401);

  const protectedUploads = await request.get(`${remoteApiUrl}/api/uploads?month=2026-04`);
  expect(protectedUploads.status()).toBe(401);
});

test("@staging-api api smoke autenticado valida endpoints clave cuando hay token", async ({ request }) => {
  test.skip(!remoteToken, "Falta E2E_STAGING_BEARER_TOKEN");

  const authHeaders = {
    Authorization: `Bearer ${remoteToken}`,
  };

  const accounts = await request.get(`${remoteApiUrl}/api/accounts`, { headers: authHeaders });
  expect(accounts.ok()).toBeTruthy();

  const summary = await request.get(`${remoteApiUrl}/api/transactions/summary?month=2026-04`, {
    headers: authHeaders,
  });
  expect(summary.ok()).toBeTruthy();

  const uploads = await request.get(`${remoteApiUrl}/api/uploads?month=2026-04`, {
    headers: authHeaders,
  });
  expect(uploads.ok()).toBeTruthy();

  const assistant = await request.post(`${remoteApiUrl}/api/assistant/chat`, {
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    data: {
      month: "2026-04",
      question: "Como viene mi mes?",
    },
  });
  expect(assistant.ok()).toBeTruthy();
});

test("@staging-ui ui smoke valida shell remota o alerta de configuracion", async ({ page }) => {
  await page.goto(remoteWebUrl, { waitUntil: "domcontentloaded" });

  const loadingCopy = page.getByText(/Conectando con el servidor/i);
  await loadingCopy.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

  await expect.poll(
    async () => {
      if (await page.getByTestId("cloud-config-warning").count()) return true;
      if (await page.getByTestId("tab-dashboard").count()) return true;
      if (await page.getByText(/Dashboard/i).count()) return true;
      if (await page.getByText(/Authentication required/i).count()) return true;
      if (await page.getByText(/Inici|continuar/i).count()) return true;
      return false;
    },
    {
      timeout: 30000,
      message: "La web remota deberia resolver a shell, auth o warning explicito",
    },
  ).toBe(true);
});
