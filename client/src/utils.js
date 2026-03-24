export const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function fmtMoney(amount, currency = "UYU") {
  const prefix = currency === "USD" ? "US$" : currency === "ARS" ? "AR$" : "$";
  const value = Number(amount || 0);
  const rounded =
    currency === "USD"
      ? Math.abs(value).toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(Math.abs(value)).toLocaleString("es-UY");
  return `${value < 0 ? "-" : ""}${prefix}${rounded}`;
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

