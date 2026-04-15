import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const webUrl = process.env.E2E_STAGING_WEB_URL || "https://smartfinance-saas-web.pages.dev";
const outputPath = process.env.E2E_STAGING_STORAGE_STATE || path.resolve(".auth", "staging-storage-state.json");

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  await ensureDir(outputPath);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log(`Abriendo ${webUrl}`);
  console.log("Inicia sesion manualmente en la ventana del navegador.");
  console.log(`Cuando veas la app o el boton de usuario, se guardara la sesion en:\n${outputPath}`);

  await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await page.waitForFunction(
    () => {
      const hasUserButton = Boolean(document.querySelector('[data-clerk-user-button-root]'));
      const hasTabs = Boolean(document.querySelector('[data-testid="tab-dashboard"]'));
      return hasUserButton || hasTabs;
    },
    { timeout: 10 * 60_000 },
  );

  await page.context().storageState({ path: outputPath });
  console.log(`Sesion guardada en ${outputPath}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
