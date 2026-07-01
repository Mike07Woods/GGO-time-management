// src/index.js
// Application entry point. React renders everything from here into public/index.html's #root div.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

// Global stylesheet — loaded once here so the theme applies across the whole app.
import './styles/global.css';

// React 18 "createRoot" API.
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    {/* ErrorBoundary catches render crashes and shows a friendly fallback. */}
    <ErrorBoundary>
      {/* BrowserRouter enables client-side routing (URLs without page reloads). */}
      <BrowserRouter>
        {/* AuthProvider exposes the session, user, profile and role to every page. */}
        <AuthProvider>
          {/* ToastProvider exposes useToast() for app-wide notifications. */}
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

// Register the service worker so the app is installable (production only —
// avoids caching headaches during local development).
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration failures are non-fatal */
    });
  });
}
