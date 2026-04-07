export default function ShortcutsModal({ onClose }) {
  const SHORTCUTS = [
    {
      section: "Navegación",
      keys: [
        { keys: ["Ctrl", "K"], desc: "Abrir búsqueda global" },
        { keys: ["?"], desc: "Mostrar esta ayuda" },
        { keys: ["Esc"], desc: "Cerrar modal / cancelar" },
      ]
    },
    {
      section: "Tabla de transacciones",
      keys: [
        { keys: ["/"], desc: "Enfocar barra de búsqueda" },
        { keys: ["Clic en categoría"], desc: "Cambiar categoría de la transacción" },
        { keys: ["Doble clic en descripción"], desc: "Editar descripción" },
      ]
    },
    {
      section: "Dashboard",
      keys: [
        { keys: ["Clic en gráfico"], desc: "Filtrar tabla por categoría" },
        { keys: ["← →"], desc: "Navegar meses (en selector)" },
      ]
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-finance-ink/30 backdrop-blur-sm dark:bg-black/50" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <h2 className="font-display text-2xl text-finance-ink">Atajos de teclado</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-finance-ink dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-6 space-y-6">
          {SHORTCUTS.map((section) => (
            <div key={section.section}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                {section.section}
              </p>
              <div className="space-y-2">
                {section.keys.map((item) => (
                  <div key={item.desc} className="flex items-center justify-between gap-4 rounded-2xl bg-finance-cream/60 px-4 py-3 dark:bg-neutral-800/60">
                    <span className="text-sm text-finance-ink dark:text-neutral-200">{item.desc}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="mx-0.5 text-xs text-neutral-400">+</span>}
                          <kbd className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold text-finance-ink shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-neutral-100 px-6 py-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-400">Los atajos no funcionan cuando el cursor está dentro de un campo de texto.</p>
        </div>
      </div>
    </div>
  );
}
