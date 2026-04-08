export const SCHEMA_VERSION = "2026-04-legacy-frontend-parity-v4";

export const DEFAULT_SETTINGS: Record<string, string> = {
  exchange_rate_usd_uyu: "42.5",
  exchange_rate_eur_uyu: "46.5",
  exchange_rate_ars_uyu: "0.045",
  effective_exchange_rate_usd_uyu: "42.5",
  effective_exchange_rate_eur_uyu: "46.5",
  effective_exchange_rate_ars_uyu: "0.045",
  exchange_rate_mode: "auto",
  exchange_rate_source: "manual_override",
  exchange_rate_updated_at: "",
  exchange_rate_fetch_error: "",
  display_currency: "UYU",
  savings_initial: "0",
  savings_monthly: "0",
  savings_goal: "200000",
  savings_currency: "UYU",
  guided_categorization_onboarding_completed: "0",
  guided_categorization_onboarding_skipped: "0",
  parsing_patterns: "[]",
  categorizer_auto_threshold: "0.9",
  categorizer_suggest_threshold: "0.72"
};
