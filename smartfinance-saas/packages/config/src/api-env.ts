import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (
  typeof value === "string" && value.trim() === "" ? undefined : value
);

const optionalUrlSchema = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const optionalStringSchema = z.preprocess(emptyStringToUndefined, z.string().optional());

const apiEnvSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  AUTH_MODE: z.enum(["development", "clerk"]).default("development"),
  UPLOAD_BINARY_STORAGE: z.enum(["disabled", "r2"]).default("disabled"),
  CLERK_JWKS_URL: optionalUrlSchema,
  STRIPE_SECRET_KEY: optionalStringSchema,
  STRIPE_WEBHOOK_SECRET: optionalStringSchema,
  STRIPE_PRICE_PRO_MONTHLY: optionalStringSchema,
  STRIPE_PRICE_PRO_YEARLY: optionalStringSchema,
  APP_BASE_URL: optionalUrlSchema,
  ALLOWED_ORIGINS: optionalStringSchema,
  AI_PROVIDER: z.enum(["auto", "cloudflare", "disabled"]).default("auto"),
  AI_TEXT_MODEL: optionalStringSchema,
  ERROR_REPORTING_WEBHOOK_URL: optionalUrlSchema,
}).superRefine((env, ctx) => {
  if (env.APP_ENV !== "local" && env.AUTH_MODE !== "clerk") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_MODE"],
      message: "Non-local environments must use Clerk auth",
    });
  }

  if (env.AUTH_MODE === "clerk" && !env.CLERK_JWKS_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CLERK_JWKS_URL"],
      message: "CLERK_JWKS_URL is required when AUTH_MODE=clerk",
    });
  }

  if (env.UPLOAD_BINARY_STORAGE === "r2" && env.APP_ENV !== "local") {
    // R2 bucket binding is validated at runtime by the worker because bindings are not part of env parsing.
  }

  const hasStripe =
    Boolean(env.STRIPE_SECRET_KEY) ||
    Boolean(env.STRIPE_PRICE_PRO_MONTHLY) ||
    Boolean(env.STRIPE_PRICE_PRO_YEARLY) ||
    Boolean(env.STRIPE_WEBHOOK_SECRET);
  if (hasStripe && !env.STRIPE_SECRET_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STRIPE_SECRET_KEY"],
      message: "STRIPE_SECRET_KEY is required when Stripe billing is configured",
    });
  }
});

export type ApiRuntimeEnv = z.infer<typeof apiEnvSchema>;

export function parseApiRuntimeEnv(source: Record<string, string | undefined>): ApiRuntimeEnv {
  return apiEnvSchema.parse(source);
}
