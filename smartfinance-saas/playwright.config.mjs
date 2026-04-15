import { defineConfig, devices } from "@playwright/test";

const stagingWebUrl = process.env.E2E_STAGING_WEB_URL || "http://127.0.0.1:4173";
const stagingApiUrl = process.env.E2E_STAGING_API_URL || "http://127.0.0.1:8787";
const stagingStorageState = process.env.E2E_STAGING_STORAGE_STATE || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "corepack pnpm dev:api:e2e",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "corepack pnpm dev:web:e2e",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "local",
      testDir: "./e2e/local",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5174",
      },
    },
    {
      name: "staging-api",
      testDir: "./e2e/staging",
      grep: /@staging-api/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: stagingWebUrl,
      },
    },
    {
      name: "staging-ui",
      testDir: "./e2e/staging",
      grep: /@staging-ui/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: stagingWebUrl,
        storageState: stagingStorageState,
      },
    },
  ],
});
