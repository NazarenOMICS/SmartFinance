const crypto = require("crypto");

function normalizeDescription(value = "") {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildDedupHash({ fecha, monto, desc_banco }) {
  const raw = `${fecha}|${monto}|${normalizeDescription(desc_banco)}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

module.exports = {
  buildDedupHash,
  normalizeDescription
};

