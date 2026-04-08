function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseTimeout(value, fallback = 15000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const appConfig = Object.freeze({
  apiBaseUrl: trimTrailingSlash(import.meta.env.VITE_API_URL || ""),
  apiTimeoutMs: parseTimeout(import.meta.env.VITE_API_TIMEOUT_MS, 15000),
  clerkPublishableKey: String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ""),
});
