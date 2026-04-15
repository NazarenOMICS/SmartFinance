import { describe, expect, test, vi } from "vitest";
import { verifyClerkToken } from "./auth";

const jwksUrl = "https://issuer.example/.well-known/jwks.json";
const issuerUrl = "https://issuer.example";
const allowedAzp = "https://app.example";

function base64Url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createToken(payloadOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey) as JsonWebKey & { kid?: string };
  publicJwk.kid = "test-key";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }))));

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: "test-key",
    ...headerOverrides,
  };
  const payload = {
    sub: "user_test",
    iss: issuerUrl,
    azp: allowedAzp,
    exp: now + 3600,
    nbf: now - 60,
    ...payloadOverrides,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
}

describe("verifyClerkToken", () => {
  test("accepts a signed token with expected issuer and azp", async () => {
    const token = await createToken();
    await expect(verifyClerkToken(token, { jwksUrl, issuerUrl, allowedAzp })).resolves.toBe("user_test");
  });

  test("rejects missing expiration", async () => {
    const token = await createToken({ exp: undefined });
    await expect(verifyClerkToken(token, { jwksUrl, issuerUrl, allowedAzp })).rejects.toThrow("JWT expiration missing");
  });

  test("rejects future nbf", async () => {
    const token = await createToken({ nbf: Math.floor(Date.now() / 1000) + 3600 });
    await expect(verifyClerkToken(token, { jwksUrl, issuerUrl, allowedAzp })).rejects.toThrow("JWT not yet valid");
  });

  test("rejects wrong issuer", async () => {
    const token = await createToken({ iss: "https://other.example" });
    await expect(verifyClerkToken(token, { jwksUrl, issuerUrl, allowedAzp })).rejects.toThrow("JWT issuer invalid");
  });

  test("rejects wrong algorithm", async () => {
    const token = await createToken({}, { alg: "HS256" });
    await expect(verifyClerkToken(token, { jwksUrl, issuerUrl, allowedAzp })).rejects.toThrow("JWT algorithm invalid");
  });
});
