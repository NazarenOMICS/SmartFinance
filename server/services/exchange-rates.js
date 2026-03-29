const { upsertSetting, getSettingsObject } = require("../db");

// BCU publishes rates at https://www.bcu.gub.uy indicators service.
// We use the BROU public rates as a simpler, more reliable alternative.
// Fallback: hardcoded recent values if all APIs fail.

const BROU_URL = "https://www.brou.com.uy/c/portal/render_portlet?p_l_id=20593&p_t_lifecycle=0&p_p_id=cotaborou_WAR_cotaborouportlet&p_p_col_id=column-1&p_p_col_count=1&p_p_mode=view";

/**
 * Fetch exchange rates from BROU website (scrape the JSON endpoint).
 * Returns { usd_uyu, ars_uyu } or null on failure.
 */
async function fetchFromBrou() {
  try {
    const res = await fetch("https://www.brou.com.uy/c/portal/render_portlet?p_l_id=20593&p_p_lifecycle=2&p_p_id=cotaborou_WAR_cotaborouportlet&p_p_mode=view&p_p_resource_id=getRates", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const text = await res.text();

    // Try parsing as JSON first
    try {
      const data = JSON.parse(text);
      // BROU JSON format varies; look for USD and ARS buy/sell
      if (Array.isArray(data)) {
        let usd = null, ars = null;
        for (const item of data) {
          const name = String(item.moneda || item.Moneda || item.name || "").toUpperCase();
          if (name.includes("USD") || name.includes("DOLAR")) {
            usd = Number(item.compra || item.Compra || item.buy) || null;
          }
          if (name.includes("ARG") || name.includes("ARS") || name.includes("PESO ARG")) {
            ars = Number(item.compra || item.Compra || item.buy) || null;
          }
        }
        if (usd) return { usd_uyu: usd, ars_uyu: ars };
      }
    } catch { /* not JSON, try HTML scraping */ }

    return null;
  } catch {
    return null;
  }
}

/**
 * Alternative: fetch from a public free API (exchangerate-api or similar).
 */
async function fetchFromOpenApi() {
  try {
    // Free tier, no key needed, 1500 req/month
    const res = await fetch("https://open.er-api.com/v6/latest/UYU", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result !== "success" || !data.rates) return null;

    const usdRate = data.rates.USD;
    const arsRate = data.rates.ARS;

    if (!usdRate || !arsRate) return null;

    // API gives UYU→X, we need X→UYU (i.e., 1 USD = ? UYU)
    return {
      usd_uyu: Math.round((1 / usdRate) * 1000) / 1000,
      ars_uyu: Math.round((1 / arsRate) * 1000) / 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Try all sources in order, return the first success.
 */
async function fetchRates() {
  const brou = await fetchFromBrou();
  if (brou?.usd_uyu) return { source: "BROU", ...brou };

  const open = await fetchFromOpenApi();
  if (open?.usd_uyu) return { source: "open.er-api.com", ...open };

  return null;
}

/**
 * Fetch and persist rates. Returns the result or null.
 */
async function refreshExchangeRates() {
  const rates = await fetchRates();
  if (!rates) return null;

  upsertSetting("exchange_rate_usd_uyu", String(rates.usd_uyu));
  if (rates.ars_uyu) {
    upsertSetting("exchange_rate_ars_uyu", String(rates.ars_uyu));
  }
  upsertSetting("exchange_rates_source", rates.source);
  upsertSetting("exchange_rates_updated", new Date().toISOString());

  return rates;
}

/**
 * Start a daily refresh interval. Call once at server startup.
 */
let _intervalId = null;
function startDailyRefresh() {
  // Refresh immediately on startup
  refreshExchangeRates()
    .then((r) => {
      if (r) console.log(`Exchange rates updated from ${r.source}: USD/UYU=${r.usd_uyu}`);
      else console.log("Exchange rates: could not fetch, using stored values.");
    })
    .catch(() => {});

  // Then every 6 hours
  if (!_intervalId) {
    _intervalId = setInterval(() => {
      refreshExchangeRates().catch(() => {});
    }, 6 * 60 * 60 * 1000);
  }
}

module.exports = {
  fetchRates,
  refreshExchangeRates,
  startDailyRefresh,
};
