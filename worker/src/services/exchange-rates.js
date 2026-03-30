import { upsertSystemMeta } from "../db.js";

const EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/UYU";

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

export async function fetchExchangeRates() {
  const response = await fetch(EXCHANGE_RATE_API_URL, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`exchange_rate_api_http_${response.status}`);
  }

  const data = await response.json();
  if (data?.result !== "success" || !data?.rates?.USD || !data?.rates?.EUR || !data?.rates?.ARS) {
    throw new Error("exchange_rate_api_invalid_payload");
  }

  return {
    source: "open.er-api.com",
    usd_uyu: roundRate(1 / Number(data.rates.USD)),
    eur_uyu: roundRate(1 / Number(data.rates.EUR)),
    ars_uyu: roundRate(1 / Number(data.rates.ARS)),
  };
}

export async function refreshExchangeRates(env) {
  try {
    const rates = await fetchExchangeRates();
    const updatedAt = new Date().toISOString();

    await Promise.all([
      upsertSystemMeta(env, "exchange_rate_usd_uyu", String(rates.usd_uyu)),
      upsertSystemMeta(env, "exchange_rate_eur_uyu", String(rates.eur_uyu)),
      upsertSystemMeta(env, "exchange_rate_ars_uyu", String(rates.ars_uyu)),
      upsertSystemMeta(env, "exchange_rate_source", rates.source),
      upsertSystemMeta(env, "exchange_rate_updated_at", updatedAt),
      upsertSystemMeta(env, "exchange_rate_fetch_error", ""),
    ]);

    return { ...rates, updated_at: updatedAt };
  } catch (error) {
    await upsertSystemMeta(env, "exchange_rate_fetch_error", String(error?.message || "exchange_rate_refresh_failed"));
    return null;
  }
}
