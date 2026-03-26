/**
 * Clerk JWT verification for Cloudflare Workers.
 * Uses Web Crypto API (built into Workers runtime) — no npm packages needed.
 *
 * Requires env var: CLERK_JWKS_URL
 * e.g. https://your-app.clerk.accounts.dev/.well-known/jwks.json
 */

// In-memory JWKS cache (lives for the duration of the Worker instance)
let jwksCache = null;
let jwksCachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getJwks(jwksUrl) {
  const now = Date.now();
  if (jwksCache && now - jwksCachedAt < CACHE_TTL_MS) return jwksCache;
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);
  jwksCache = await res.json();
  jwksCachedAt = now;
  return jwksCache;
}

function base64UrlDecode(str) {
  // Pad base64url to standard base64, then decode
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + (4 - (str.length % 4)) % 4, "=");
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function parseJwtParts(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT structure");
  const header  = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

async function importRsaPublicKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function verifyJwtSignature(signingInput, signatureB64url, key) {
  const data = new TextEncoder().encode(signingInput);
  const sig  = base64UrlDecode(signatureB64url);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
}

/**
 * Hono middleware — verifies Clerk JWT and sets c.set("userId", sub).
 * Returns 401 if token is missing or invalid.
 */
export async function clerkAuth(c, next) {
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const jwksUrl = c.env.CLERK_JWKS_URL;
    if (!jwksUrl) throw new Error("CLERK_JWKS_URL env var not set");

    const { header, payload, signingInput, signature } = parseJwtParts(token);

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return c.json({ error: "Token expired" }, 401);
    }

    // Find the matching key by kid
    const jwks = await getJwks(jwksUrl);
    const jwk  = jwks.keys?.find((k) => k.kid === header.kid);
    if (!jwk) {
      // kid not found — maybe JWKS rotated, invalidate cache and retry once
      jwksCache = null;
      const freshJwks = await getJwks(jwksUrl);
      const freshJwk  = freshJwks.keys?.find((k) => k.kid === header.kid);
      if (!freshJwk) return c.json({ error: "Unknown signing key" }, 401);
    }

    const matchedJwk = jwks.keys?.find((k) => k.kid === header.kid);
    const publicKey  = await importRsaPublicKey(matchedJwk);
    const valid      = await verifyJwtSignature(signingInput, signature, publicKey);

    if (!valid) return c.json({ error: "Invalid token signature" }, 401);

    // All good — expose userId to downstream handlers
    c.set("userId", payload.sub);
    await next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return c.json({ error: "Authentication failed" }, 401);
  }
}
