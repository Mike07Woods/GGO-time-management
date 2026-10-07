// src/App.js
// Top-level routing. Public /login, plus a protected layout (sidebar + navbar)
// that wraps all seven authenticated pages.

import React, { Suspense, lazy, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import RequireAccess from './components/RequireAccess';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import ChatPopup from './components/ChatPopup';
import LoadingScreen from './components/LoadingScreen';
import MobileGate from './components/MobileGate';
import { PresenceProvider } from './context/PresenceContext';

// Login and Dashboard are the first screens most people see, so they ship in the
// main bundle. Every other page is split into its own chunk and downloaded the
// first time it is opened (React.lazy), which keeps the first load small.
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Directory = lazy(() => import('./pages/Directory'));
const Scheduling = lazy(() => import('./pages/Scheduling'));
const TimeClock = lazy(() => import('./pages/TimeClock'));
const Announcements = lazy(() => import('./pages/Announcements'));
const Notifications = lazy(() => import('./pages/Notifications'));

// Phase 2 pages
const Timesheets = lazy(() => import('./pages/Timesheets'));
const Overtime = lazy(() => import('./pages/Overtime'));
const Forms = lazy(() => import('./pages/Forms'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Reports = lazy(() => import('./pages/Reports'));

// Phase 3 pages
const Chat = lazy(() => import('./pages/Chat'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const HelpDesk = lazy(() => import('./pages/HelpDesk'));
const Events = lazy(() => import('./pages/Events'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const Departments = lazy(() => import('./pages/Departments'));
const TeamStatus = lazy(() => import('./pages/TeamStatus'));
const Settings = lazy(() => import('./pages/Settings'));

// Shown while a page's chunk is downloading.
function PageFallback() {
  return (
    <div style={{ padding: 24 }} className="dim">
      Loading…
    </div>
  );
}

// The chrome shown around every authenticated page.
// ProtectedRoute guards it; <Outlet /> renders the matched child route.
function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <MobileGate>
        <PresenceProvider>
          <ShellWithSidebar />
        </PresenceProvider>
      </MobileGate>
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
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
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
      <Suspense fallback={<PageFallback />}>
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
        <Route path="/forms" element={<RequireAccess pageKey="forms"><Forms /></RequireAccess>} />
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
      </Suspense>
    </>
  );
}
