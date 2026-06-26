// src/App.js
// Top-level routing. Public /login, plus a protected layout (sidebar + navbar)
// that wraps all seven authenticated pages.

import React, { useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import ChatPopup from './components/ChatPopup';
import LoadingScreen from './components/LoadingScreen';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Directory from './pages/Directory';
import Scheduling from './pages/Scheduling';
import TimeClock from './pages/TimeClock';
import Announcements from './pages/Announcements';
import Notifications from './pages/Notifications';

// Phase 2 pages
import Timesheets from './pages/Timesheets';
import Overtime from './pages/Overtime';
import Forms from './pages/Forms';
import Tasks from './pages/Tasks';
import Reports from './pages/Reports';

// Phase 3 pages
import Chat from './pages/Chat';
import KnowledgeBase from './pages/KnowledgeBase';
import HelpDesk from './pages/HelpDesk';
import Events from './pages/Events';
import AuditLog from './pages/AuditLog';

// The chrome shown around every authenticated page.
// ProtectedRoute guards it; <Outlet /> renders the matched child route.
function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <>
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">
            <Navbar />
            <main className="app-content">
              <Outlet />
            </main>
          </div>
        </div>
        {/* Floating chat widget — visible on every authenticated page */}
        <ChatPopup />
      </>
    </ProtectedRoute>
  );
}

export default function App() {
  // Branded splash on first load (~2.2s + fade).
  const [booting, setBooting] = useState(true);

  return (
    <>
      {booting && <LoadingScreen onComplete={() => setBooting(false)} />}
      <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Protected area — everything below requires a logged-in user */}
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        {/* Directory is blocked for regular users — managers and above only */}
        <Route
          path="/directory"
          element={
            <ProtectedRoute requiredRole="manager">
              <Directory />
            </ProtectedRoute>
          }
        />
        <Route path="/scheduling" element={<Scheduling />} />
        <Route path="/timeclock" element={<TimeClock />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/notifications" element={<Notifications />} />

        {/* --- Phase 2 routes --- */}
        <Route path="/timesheets" element={<Timesheets />} />
        {/* Overtime is manager and above only */}
        <Route
          path="/overtime"
          element={
            <ProtectedRoute requiredRole="manager">
              <Overtime />
            </ProtectedRoute>
          }
        />
        <Route path="/forms" element={<Forms />} />
        <Route path="/tasks" element={<Tasks />} />
        {/* Reports are owner/admin only */}
        <Route
          path="/reports"
          element={
            <ProtectedRoute requiredRole="admin">
              <Reports />
            </ProtectedRoute>
          }
        />

        {/* --- Phase 3 routes --- */}
        <Route path="/chat" element={<Chat />} />
        <Route path="/knowledge" element={<KnowledgeBase />} />
        <Route path="/helpdesk" element={<HelpDesk />} />
        <Route path="/events" element={<Events />} />
        {/* Audit Log is owner only */}
        <Route
          path="/audit"
          element={
            <ProtectedRoute requiredRole="owner">
              <AuditLog />
            </ProtectedRoute>
          }
        />
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
    </>
  );
}
