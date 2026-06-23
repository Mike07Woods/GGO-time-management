// src/App.js
// Top-level routing. Public /login, plus a protected layout (sidebar + navbar)
// that wraps all seven authenticated pages.

import React from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Directory from './pages/Directory';
import Scheduling from './pages/Scheduling';
import TimeClock from './pages/TimeClock';
import Announcements from './pages/Announcements';
import Notifications from './pages/Notifications';

// The chrome shown around every authenticated page.
// ProtectedRoute guards it; <Outlet /> renders the matched child route.
function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <Navbar />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Protected area — everything below requires a logged-in user */}
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/directory" element={<Directory />} />
        <Route path="/scheduling" element={<Scheduling />} />
        <Route path="/timeclock" element={<TimeClock />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/notifications" element={<Notifications />} />
        {/*
          Example of a role-restricted route (left here as documentation):
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminOnlyPage />
              </ProtectedRoute>
            }
          />
        */}
      </Route>

      {/* Anything else -> dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
