function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseTimeout(value, fallback = 15000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveApiBaseUrl() {
  const explicit = trimTrailingSlash(import.meta.env.VITE_API_URL || "");
  if (explicit) return explicit;

  if (import.meta.env.PROD) {
    return "https://smartfinance-saas-api-production.nazarenocabrerati.workers.dev";
  }

  return "";
}

export const appConfig = Object.freeze({
  apiBaseUrl: resolveApiBaseUrl(),
  apiTimeoutMs: parseTimeout(import.meta.env.VITE_API_TIMEOUT_MS, 15000),
  clerkPublishableKey: String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ""),
  expectsCloudAuth:
    Boolean(resolveApiBaseUrl()) &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(resolveApiBaseUrl()),
});
