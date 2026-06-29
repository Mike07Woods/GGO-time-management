// src/index.js
// Application entry point. React renders everything from here into public/index.html's #root div.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

// Global stylesheet — loaded once here so the theme applies across the whole app.
import './styles/global.css';

// React 18 "createRoot" API.
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
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
  </React.StrictMode>
);
