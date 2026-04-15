import type { ApiBindings } from "../env";
import { getRuntimeEnv } from "../env";

export async function reportError(
  env: ApiBindings,
  payload: {
    request_id?: string;
    path?: string;
    method?: string;
    status?: number;
    user_id?: string | null;
    message: string;
    source: "api" | "web";
    extra?: Record<string, unknown>;
  },
) {
  const runtime = getRuntimeEnv(env);
  const url = String(runtime.ERROR_REPORTING_WEBHOOK_URL || "").trim();
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app: "smartfinance-saas",
        env: runtime.APP_ENV,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    });
  } catch {
    // Avoid cascading failures while reporting errors.
  }
}
