export const SCHEMA_VERSION = "2026-04-upload-ingestion-v3";

export const DEFAULT_SETTINGS: Record<string, string> = {
  exchange_rate_usd_uyu: "42.5",
  exchange_rate_eur_uyu: "46.5",
  exchange_rate_ars_uyu: "0.045",
  exchange_rate_mode: "auto",
  display_currency: "UYU",
  savings_initial: "0",
  savings_goal: "200000",
  savings_currency: "UYU",
  parsing_patterns: "[]",
  categorizer_auto_threshold: "0.9",
  categorizer_suggest_threshold: "0.72"
};
