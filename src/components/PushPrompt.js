// src/components/PushPrompt.js
// Subtle dashboard banner inviting the user to enable push notifications.
// Hidden if: push unsupported/unconfigured, already granted, or dismissed within
// the last 7 days (localStorage: push_dismissed_at).

import React, { useState } from 'react';
import { Bell, X, Share } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';
import {
  pushSupported,
  pushConfigured,
  pushPermission,
  requestAndSavePushSubscription,
} from '../lib/pushNotifications';

const DISMISS_KEY = 'push_dismissed_at';
const WEEK_MS = 7 * 24 * 3600 * 1000;

// iOS/iPadOS detection (iPadOS reports a Mac UA but has touch).
function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

// Running as an installed PWA (standalone), where iOS allows web push.
function isStandalone() {
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

export default function PushPrompt() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < WEEK_MS;
    } catch (e) {
      return false;
    }
  });

  if (hidden || !user) return null;

  // iOS in a Safari tab can't do web push at all — it must be installed to the
  // Home Screen first. Show install instructions instead of an Enable button.
  const iosNeedsInstall = isIOS() && !isStandalone();
  if (iosNeedsInstall) {
    return (
      <div className="push-banner">
        <Share size={18} style={{ flexShrink: 0, color: 'var(--accent-text)' }} />
        <span style={{ flex: 1 }}>
          On iPhone/iPad, tap <strong>Share</strong> then <strong>“Add to Home Screen”</strong>, open GGO
          from its icon, and you’ll be able to turn on notifications.
        </span>
        <button className="btn--icon" onClick={dismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
        <style>{`
          .push-banner {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            background: var(--accent-light); border: 1px solid var(--border);
            color: var(--text-primary); padding: 10px 14px;
            border-radius: var(--radius-md); margin-bottom: 16px; font-size: 14px;
          }
        `}</style>
      </div>
    );
  }

  if (!pushSupported() || !pushConfigured()) return null;
  if (pushPermission() === 'granted' || pushPermission() === 'denied') return null;

  async function enable() {
    setBusy(true);
    const ok = await requestAndSavePushSubscription(user.id, supabase);
    setBusy(false);
    if (ok) {
      toast.success('Push notifications enabled');
      setHidden(true);
    } else {
      toast.error('Notifications weren’t enabled.');
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {
      /* ignore storage errors */
    }
    setHidden(true);
  }

  return (
    <div className="push-banner">
      <Bell size={18} style={{ flexShrink: 0, color: 'var(--accent-text)' }} />
      <span style={{ flex: 1 }}>Enable push notifications to stay updated on the go.</span>
      <button className="btn btn--primary btn--sm" onClick={enable} disabled={busy}>
        {busy ? 'Enabling…' : 'Enable'}
      </button>
      <button className="btn btn--ghost btn--sm" onClick={dismiss}>
        Not now
      </button>
      <button className="btn--icon" onClick={dismiss} aria-label="Dismiss">
        <X size={15} />
      </button>
      <style>{`
        .push-banner {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          background: var(--accent-light); border: 1px solid var(--border);
          color: var(--text-primary); padding: 10px 14px;
          border-radius: var(--radius-md); margin-bottom: 16px; font-size: 14px;
        }
      `}</style>
    </div>
  );
}
