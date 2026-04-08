import { z } from "zod";

const webEnvSchema = z.object({
  VITE_API_URL: z.string().default("http://127.0.0.1:8787"),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional()
});

export type WebRuntimeEnv = z.infer<typeof webEnvSchema>;

export function parseWebRuntimeEnv(source: Record<string, string | undefined>): WebRuntimeEnv {
  return webEnvSchema.parse(source);
}
