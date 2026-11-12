import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback(({ message, type = 'info', duration = 3000 }) => {
    // Use a combination of timestamp and a counter to avoid Date.now() collisions
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-[calc(var(--assistant-toast-offset,1rem)+env(safe-area-inset-bottom))] right-4 sm:right-[var(--assistant-toast-right,1rem)] z-[200] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-overlay-in ${
              t.type === 'error'
                ? 'bg-red-600/90 text-white'
                : t.type === 'success'
                  ? 'bg-green-600/90 text-white'
                  : 'bg-slate-700 text-slate-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
