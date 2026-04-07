// Uses Web Crypto API (native to Cloudflare Workers, no polyfill needed)
function normalizeDescription(value = "") {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function buildDedupHash({ fecha, monto, desc_banco }) {
  const raw = `${fecha}|${monto}|${normalizeDescription(desc_banco)}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
