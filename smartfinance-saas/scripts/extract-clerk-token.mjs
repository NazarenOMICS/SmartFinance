import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const webUrl = process.env.E2E_STAGING_WEB_URL || "https://smartfinance-saas-web.pages.dev";
const storageStatePath = process.env.E2E_STAGING_STORAGE_STATE || path.resolve(".auth", "staging-storage-state.json");
const outputPath = path.resolve(".auth", "staging-bearer-token.txt");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(storageStatePath))) {
    throw new Error(`No encontre storage state en ${storageStatePath}. Corre primero: corepack pnpm auth:staging:login`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ storageState: storageStatePath });

  await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4_000);

  const token = await page.evaluate(async () => {
    const clerk = globalThis.Clerk;
    if (!clerk) return null;

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (clerk.loaded && clerk.session) {
        return clerk.session.getToken();
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
  });

  if (!token) {
    throw new Error("No pude obtener un bearer token desde la sesion guardada. Repite el login y asegurate de entrar completamente a la app.");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${token}\n`, "utf8");

  console.log(token);
  console.log(`\nBearer token guardado en ${outputPath}`);
  console.log("Podes usarlo asi en PowerShell:");
  console.log(`$env:E2E_STAGING_BEARER_TOKEN='${token}'`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
