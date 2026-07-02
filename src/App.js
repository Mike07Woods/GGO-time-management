// src/App.js
// Top-level routing. Public /login, plus a protected layout (sidebar + navbar)
// that wraps all seven authenticated pages.

import React, { useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import RequireAccess from './components/RequireAccess';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import ChatPopup from './components/ChatPopup';
import LoadingScreen from './components/LoadingScreen';
import { PresenceProvider } from './context/PresenceContext';

import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import ResetPassword from './pages/ResetPassword';
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
import UserManagement from './pages/UserManagement';
import Departments from './pages/Departments';
import TeamStatus from './pages/TeamStatus';
import Settings from './pages/Settings';

// The chrome shown around every authenticated page.
// ProtectedRoute guards it; <Outlet /> renders the matched child route.
function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <PresenceProvider>
        <ShellWithSidebar />
      </PresenceProvider>
    </ProtectedRoute>
  );
}

// Authenticated shell: sidebar (drawer on mobile) + navbar + page content.
function ShellWithSidebar() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <>
      <div className="app-shell">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        {/* Backdrop behind the mobile drawer */}
        <div
          className={'gsb-backdrop' + (mobileNavOpen ? ' show' : '')}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
        <div className="app-main">
          <Navbar onMenuClick={() => setMobileNavOpen(true)} />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
      {/* Floating chat widget — visible on every authenticated page */}
      <ChatPopup />
    </>
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
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected area — everything below requires a logged-in user */}
      {/* Page access is governed by src/lib/permissions.js (PAGE_ACCESS).
          RequireAccess redirects to the dashboard if the role isn't allowed. */}
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/directory" element={<RequireAccess pageKey="directory"><Directory /></RequireAccess>} />
        <Route path="/scheduling" element={<RequireAccess pageKey="scheduling"><Scheduling /></RequireAccess>} />
        <Route path="/timeclock" element={<TimeClock />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/notifications" element={<Notifications />} />

        {/* --- Phase 2 routes --- */}
        <Route path="/timesheets" element={<RequireAccess pageKey="timesheets"><Timesheets /></RequireAccess>} />
        <Route path="/overtime" element={<RequireAccess pageKey="overtime"><Overtime /></RequireAccess>} />
        <Route path="/forms" element={<Forms />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/reports" element={<RequireAccess pageKey="reports"><Reports /></RequireAccess>} />

        {/* --- Phase 3 routes --- */}
        <Route path="/chat" element={<Chat />} />
        <Route path="/team-status" element={<RequireAccess pageKey="team_status"><TeamStatus /></RequireAccess>} />
        <Route path="/knowledge" element={<RequireAccess pageKey="knowledge"><KnowledgeBase /></RequireAccess>} />
        <Route path="/helpdesk" element={<RequireAccess pageKey="helpdesk"><HelpDesk /></RequireAccess>} />
        <Route path="/events" element={<RequireAccess pageKey="events"><Events /></RequireAccess>} />
        <Route path="/departments" element={<RequireAccess pageKey="departments"><Departments /></RequireAccess>} />
        <Route path="/users" element={<RequireAccess pageKey="users"><UserManagement /></RequireAccess>} />
        <Route path="/audit" element={<RequireAccess pageKey="audit"><AuditLog /></RequireAccess>} />

        {/* Available to every signed-in user */}
        <Route path="/settings" element={<Settings />} />
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
