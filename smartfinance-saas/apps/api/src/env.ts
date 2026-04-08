import { parseApiRuntimeEnv } from "@smartfinance/config";
import type { D1DatabaseLike } from "@smartfinance/database";

export type ApiBindings = {
  DB: D1DatabaseLike;
  AUTH_MODE?: string;
  CLERK_JWKS_URL?: string;
  STRIPE_SECRET_KEY?: string;
};

export type ApiVariables = {
  requestId: string;
  auth: {
    userId: string;
    authMode: "development" | "clerk";
  };
};

export function getRuntimeEnv(env: ApiBindings) {
  return parseApiRuntimeEnv({
    AUTH_MODE: env.AUTH_MODE,
    CLERK_JWKS_URL: env.CLERK_JWKS_URL,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
  });
}
