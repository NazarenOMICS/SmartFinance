export const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const SUPPORTED_CURRENCIES = ["UYU", "USD", "EUR", "ARS"];
export const SUPPORTED_CURRENCY_OPTIONS = [
  { value: "UYU", label: "UYU" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "ARS", label: "ARS" },
];
export const CURRENCY_LABELS = {
  UYU: "Pesos",
  USD: "Dolares",
  EUR: "Euros",
  ARS: "Pesos AR",
};
export const EXCHANGE_RATE_CURRENCIES = ["USD", "EUR", "ARS"];
const CURRENCY_META = {
  UYU: { prefix: "$", decimals: 0 },
  USD: { prefix: "US$", decimals: 2 },
  EUR: { prefix: "EUR ", decimals: 2 },
  ARS: { prefix: "AR$", decimals: 0 },
};
const DEFAULT_EXCHANGE_RATE_VALUES = {
  USD: 42.5,
  EUR: 46.5,
  ARS: 0.045,
};

export function getExchangeRateSettingKey(currency) {
  return `exchange_rate_${String(currency || "").toLowerCase()}_uyu`;
}

export function getExchangeRateMap(settings = {}) {
  return EXCHANGE_RATE_CURRENCIES.reduce((acc, currency) => {
    const key = getExchangeRateSettingKey(currency);
    const parsed = Number(settings[`effective_${key}`] || settings[key] || DEFAULT_EXCHANGE_RATE_VALUES[currency]);
    acc[currency] = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXCHANGE_RATE_VALUES[currency];
    return acc;
  }, { UYU: 1 });
}

export function convertCurrencyAmount(amount, sourceCurrency, targetCurrency, exchangeRates = {}) {
  const value = Number(amount || 0);
  const source = String(sourceCurrency || targetCurrency || "UYU").toUpperCase();
  const target = String(targetCurrency || source || "UYU").toUpperCase();
  const rates = { UYU: 1, ...exchangeRates };

  if (!target || source === target) return value;

  let inUyu = value;
  if (source !== "UYU") {
    const sourceRate = Number(rates[source]);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) return value;
    inUyu = value * sourceRate;
  }

  if (target === "UYU") return inUyu;

  const targetRate = Number(rates[target]);
  if (!Number.isFinite(targetRate) || targetRate <= 0) return inUyu;
  return inUyu / targetRate;
}

export function fmtMoney(amount, currency = "UYU") {
  const meta = CURRENCY_META[currency] || { prefix: `${currency} `, decimals: 2 };
  const value = Number(amount || 0);
  const rounded = meta.decimals > 0
    ? Math.abs(value).toLocaleString("es-UY", { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals })
    : Math.round(Math.abs(value)).toLocaleString("es-UY");
  return `${value < 0 ? "-" : ""}${meta.prefix}${rounded}`;
}

export function fmtPct(value) {
  if (!Number.isFinite(value)) return "0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)}%`;
}

export function monthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${MONTH_LABELS[monthNumber - 1]} ${year}`;
}

export function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split("-").map(Number);
  const absolute = year * 12 + (monthNumber - 1) + delta;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = (absolute % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function isoMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shortDate(isoDate) {
  if (!isoDate) return "—";
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

