import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);

const ICONS  = { success: "✓", error: "✕", info: "◉", warning: "⚠" };
const STYLES = {
  success: "bg-finance-teal text-white",
  error:   "bg-finance-red text-white",
  info:    "bg-finance-blue text-white",
  warning: "bg-finance-amber text-white",
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type, message, action = null) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { id, type, message, action }]);
    const delay = action ? 6000 : 3500;
    setTimeout(() => removeToast(id), delay);
    return id;
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-6 right-4 z-[100] flex flex-col gap-2 md:right-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl min-w-[220px] max-w-[360px] text-sm font-medium toast-enter ${STYLES[toast.type]}`}
          >
            <span className="shrink-0 text-base">{ICONS[toast.type]}</span>
            <span className="flex-1 leading-snug">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => { toast.action.fn(); removeToast(toast.id); }}
                className="shrink-0 rounded-full border border-white/50 px-3 py-1 text-xs font-bold hover:bg-white/20 transition"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 text-white/70 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
