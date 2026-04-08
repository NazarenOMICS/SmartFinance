import type { MiddlewareHandler } from "hono";
import type { ApiBindings, ApiVariables } from "../env";
import { getRuntimeEnv } from "../env";

function decodeBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getJwks(jwksUrl: string) {
  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch Clerk JWKS (${response.status})`);
  }

  return response.json() as Promise<{ keys: Array<JsonWebKey & { kid?: string }> }>;
}

async function verifyClerkToken(token: string, jwksUrl: string): Promise<string> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Invalid JWT structure");
  }

  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as { kid?: string };
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as { sub?: string; exp?: number };

  if (!payload.sub) {
    throw new Error("JWT subject missing");
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("JWT expired");
  }

  const jwks = await getJwks(jwksUrl);
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    throw new Error("JWT signing key not found");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(encodedSignature) as unknown as BufferSource,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );

  if (!valid) {
    throw new Error("JWT signature invalid");
  }

  return payload.sub;
}

export const authMiddleware: MiddlewareHandler<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}> = async (c, next) => {
  const runtimeEnv = getRuntimeEnv(c.env);

  if (runtimeEnv.AUTH_MODE === "development") {
    c.set("auth", {
      userId: "dev-user",
      authMode: "development",
    });
    await next();
    return;
  }

  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !runtimeEnv.CLERK_JWKS_URL) {
    return c.json(
      {
        error: "Authentication required",
        code: "AUTH_REQUIRED",
        request_id: c.get("requestId"),
      },
      401,
    );
  }

  try {
    const userId = await verifyClerkToken(token, runtimeEnv.CLERK_JWKS_URL);
    c.set("auth", {
      userId,
      authMode: "clerk",
    });
    await next();
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Authentication failed",
        code: "AUTH_INVALID",
        request_id: c.get("requestId"),
      },
      401,
    );
  }
};
