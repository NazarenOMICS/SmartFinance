import { parseApiRuntimeEnv } from "@smartfinance/config";
import type { D1DatabaseLike } from "@smartfinance/database";

export type ApiBindings = {
  DB: D1DatabaseLike;
  UPLOADS_BUCKET?: {
    put(
      key: string,
      value: Blob | ArrayBuffer | ArrayBufferView | string | ReadableStream,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<unknown>;
    get(key: string): Promise<{
      body: ReadableStream | null;
      httpMetadata?: { contentType?: string };
      size?: number;
    } | null>;
  };
  APP_ENV?: string;
  AUTH_MODE?: string;
  UPLOAD_BINARY_STORAGE?: string;
  CLERK_JWKS_URL?: string;
  CLERK_ISSUER_URL?: string;
  CLERK_ALLOWED_AZP?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_YEARLY?: string;
  APP_BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  AI_PROVIDER?: string;
  AI_TEXT_MODEL?: string;
  ERROR_REPORTING_WEBHOOK_URL?: string;
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
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
    APP_ENV: env.APP_ENV,
    AUTH_MODE: env.AUTH_MODE,
    UPLOAD_BINARY_STORAGE: env.UPLOAD_BINARY_STORAGE,
    CLERK_JWKS_URL: env.CLERK_JWKS_URL,
    CLERK_ISSUER_URL: env.CLERK_ISSUER_URL,
    CLERK_ALLOWED_AZP: env.CLERK_ALLOWED_AZP,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_MONTHLY: env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_PRO_YEARLY: env.STRIPE_PRICE_PRO_YEARLY,
    APP_BASE_URL: env.APP_BASE_URL,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    AI_PROVIDER: env.AI_PROVIDER,
    AI_TEXT_MODEL: env.AI_TEXT_MODEL,
    ERROR_REPORTING_WEBHOOK_URL: env.ERROR_REPORTING_WEBHOOK_URL,
  });
}
