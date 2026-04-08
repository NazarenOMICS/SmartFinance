import { z } from "zod";

const apiEnvSchema = z.object({
  AUTH_MODE: z.enum(["development", "clerk"]).default("development"),
  CLERK_JWKS_URL: z.string().url().optional(),
  STRIPE_SECRET_KEY: z.string().optional()
});

export type ApiRuntimeEnv = z.infer<typeof apiEnvSchema>;

export function parseApiRuntimeEnv(source: Record<string, string | undefined>): ApiRuntimeEnv {
  return apiEnvSchema.parse(source);
}
