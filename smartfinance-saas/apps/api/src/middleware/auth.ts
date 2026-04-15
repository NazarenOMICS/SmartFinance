import type { MiddlewareHandler } from "hono";
import type { ApiBindings, ApiVariables } from "../env";
import { getRuntimeEnv } from "../env";
import { log } from "@smartfinance/observability";

type ClerkJwtPayload = {
  sub?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  azp?: string;
  aud?: string | string[];
};

type ClerkJwtHeader = {
  alg?: string;
  kid?: string;
};

type JwksCacheEntry = {
  expiresAt: number;
  jwks: { keys: Array<JsonWebKey & { kid?: string }> };
};

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const jwksCache = new Map<string, JwksCacheEntry>();

function decodeBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getJwks(jwksUrl: string, forceRefresh = false) {
  const cached = jwksCache.get(jwksUrl);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }

  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch Clerk JWKS (${response.status})`);
  }

  const jwks = await response.json() as { keys: Array<JsonWebKey & { kid?: string }> };
  jwksCache.set(jwksUrl, {
    jwks,
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
  });
  return jwks;
}

function parseAllowedAzp(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateClaims(payload: ClerkJwtPayload, options: {
  issuerUrl: string;
  allowedAzp: string[];
}) {
  const now = Math.floor(Date.now() / 1000);

  if (!payload.sub) {
    throw new Error("JWT subject missing");
  }
  if (!payload.exp) {
    throw new Error("JWT expiration missing");
  }
  if (payload.exp <= now - CLOCK_SKEW_SECONDS) {
    throw new Error("JWT expired");
  }
  if (payload.nbf && payload.nbf > now + CLOCK_SKEW_SECONDS) {
    throw new Error("JWT not yet valid");
  }
  if (payload.iss !== options.issuerUrl) {
    throw new Error("JWT issuer invalid");
  }
  if (payload.azp && options.allowedAzp.length > 0 && !options.allowedAzp.includes(payload.azp)) {
    throw new Error("JWT authorized party invalid");
  }
}

export async function verifyClerkToken(token: string, options: {
  jwksUrl: string;
  issuerUrl: string;
  allowedAzp?: string;
}): Promise<string> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Invalid JWT structure");
  }

  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as ClerkJwtHeader;
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as ClerkJwtPayload;
  if (header.alg !== "RS256") {
    throw new Error("JWT algorithm invalid");
  }
  validateClaims(payload, {
    issuerUrl: options.issuerUrl,
    allowedAzp: parseAllowedAzp(options.allowedAzp),
  });

  let jwks = await getJwks(options.jwksUrl);
  let jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    jwks = await getJwks(options.jwksUrl, true);
    jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  }
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

  return payload.sub as string;
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

  if (!runtimeEnv.CLERK_JWKS_URL || !runtimeEnv.CLERK_ISSUER_URL) {
    return c.json(
      {
        error: "Authentication is misconfigured",
        code: "AUTH_MISCONFIGURED",
        request_id: c.get("requestId"),
      },
      500,
    );
  }

  if (!token) {
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
    const userId = await verifyClerkToken(token, {
      jwksUrl: runtimeEnv.CLERK_JWKS_URL,
      issuerUrl: runtimeEnv.CLERK_ISSUER_URL,
      allowedAzp: runtimeEnv.CLERK_ALLOWED_AZP,
    });
    c.set("auth", {
      userId,
      authMode: "clerk",
    });
    await next();
  } catch (error) {
    log("info", "auth.invalid", {
      request_id: c.get("requestId"),
      reason: error instanceof Error ? error.message : "Authentication failed",
    });
    return c.json(
      {
        error: "Authentication failed",
        code: "AUTH_INVALID",
        request_id: c.get("requestId"),
      },
      401,
    );
  }
};
