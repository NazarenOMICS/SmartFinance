const express = require("express");
const { db, getSettingsObject, normalizeSettingValue, upsertSetting } = require("../db");
const { refreshExchangeRates } = require("../services/exchange-rates");

const router = express.Router();

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function getDefaultMonth() {
  return db.prepare("SELECT MAX(substr(fecha, 1, 7)) AS month FROM transactions").get()?.month || currentMonth();
}

router.get("/", (req, res) => {
  res.json({
    ...getSettingsObject(),
    default_month: getDefaultMonth()
  });
});

router.put("/", (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.status(400).json({ error: "key is required" });
  }

  const normalizedValue = normalizeSettingValue(key, value);
  upsertSetting(key, normalizedValue);
  res.json({ key, value: normalizedValue });
});

// Force-refresh exchange rates from official sources
router.post("/refresh-rates", async (req, res) => {
  try {
    const result = await refreshExchangeRates();
    if (!result) {
      return res.status(502).json({ error: "No se pudieron obtener las tasas de cambio. Intenta más tarde." });
    }
    res.json({
      source: result.source,
      exchange_rate_usd_uyu: result.usd_uyu,
      exchange_rate_eur_uyu: result.eur_uyu,
      exchange_rate_ars_uyu: result.ars_uyu,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
