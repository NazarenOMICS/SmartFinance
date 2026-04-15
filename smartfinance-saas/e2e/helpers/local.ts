import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function resetLocalDataset(request: APIRequestContext) {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const health = await request.get("http://127.0.0.1:8787/api/health");
    if (!health.ok()) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    const response = await request.post("http://127.0.0.1:8787/api/system/test/reset");
    if (response.ok()) {
      return response.json();
    }

    lastStatus = response.status();
    lastBody = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`local test dataset reset failed with status ${lastStatus}: ${lastBody}`);
}

export async function dismissPendingReminderIfVisible(page: Page) {
  const closeButton = page.getByRole("button", { name: /Cerrar/i }).first();
  const visible = await closeButton.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false);
  if (visible) {
    await closeButton.click();
  }
}

export async function bootLocalApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("tab-dashboard")).toBeVisible();
  await expect(page.getByText(/Buen d[ií]a|Buenas tardes|Buenas noches|Noche larga/i)).toBeVisible();
  await dismissPendingReminderIfVisible(page);
}

export async function openTab(page: Page, tabId: string) {
  await dismissPendingReminderIfVisible(page);
  await page.getByTestId(`tab-${tabId}`).click();
  await dismissPendingReminderIfVisible(page);
}

export async function searchTransaction(page: Page, query: string) {
  const search = page.getByPlaceholder(/Buscar/i).first();
  await search.fill(query);
  return search;
}
