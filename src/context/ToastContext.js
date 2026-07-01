// src/context/ToastContext.js
// Lightweight app-wide toast notifications. Wrap the app in <ToastProvider> and
// call useToast() anywhere: toast.success('...'), toast.error('...'), toast.info('...').
// Toasts auto-dismiss after 4s and can be clicked to dismiss early.

import React, { createContext, useCallback, useContext, useState } from 'react';
import { friendlyError } from '../lib/friendlyError';

const ToastContext = createContext(null);

// Module-level counter for stable unique ids (no Math.random needed).
let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type, message) => {
      if (!message) return;
      const id = ++idSeq;
      setToasts((list) => [...list, { id, type, message }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove]
  );

  // Stable-ish API object; recreated only when push changes (it won't).
  const value = {
    success: (m) => push('success', m),
    // Error messages are run through friendlyError() so raw Postgres/Supabase
    // text becomes human-readable everywhere toast.error() is called.
    error: (m) => push('error', friendlyError(m)),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={'toast toast--' + t.type}
            onClick={() => remove(t.id)}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a <ToastProvider>.');
  return ctx;
}

export default ToastContext;
