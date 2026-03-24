const API_BASE = import.meta.env.VITE_API_URL || "";

export default function ExportButton({ month }) {
  return (
    <a
      href={`${API_BASE}/api/export/csv?month=${month}`}
      className="inline-flex items-center rounded-full bg-finance-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black"
    >
      Exportar CSV
    </a>
  );
}

