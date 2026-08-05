// src/components/MobileGate.js
// Blocks the app on PHONES for employees who haven't been granted mobile access.
// Managers/admins/owners are always allowed. Tablets and desktops are unaffected.
// Purpose: stop agents changing their disposition from a phone while off-site.

import React from 'react';
import { Smartphone } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import logoWhite from '../assets/ggo-full-white.png';

// Phone detection (deliberately narrow — tablets/desktops are allowed).
function isPhone() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|iemobile|mobi/i.test(ua);
}

export default function MobileGate({ children }) {
  const { profile, signOut } = useAuth();
  const { isOwner } = useRole();

  // The owner always has phone access; everyone else needs the explicit flag.
  const allowed = isOwner || profile?.mobile_access === true;

  if (!isPhone() || allowed) return children;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
        background: '#0A0F1E',
        color: '#fff',
        gap: 14,
      }}
    >
      <img src={logoWhite} alt="GGO" style={{ height: 40, objectFit: 'contain', marginBottom: 8 }} />
      <Smartphone size={34} style={{ opacity: 0.8 }} />
      <h2 style={{ margin: 0, fontSize: 20 }}>Phone access not enabled</h2>
      <p style={{ maxWidth: 340, color: '#a0aec0', margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        Your account isn’t allowed to use GGO on a phone. Please sign in from a computer, or ask an
        administrator to enable mobile access for you.
      </p>
      <button
        className="btn btn--ghost btn--sm"
        style={{ marginTop: 8, color: '#fff', borderColor: 'rgba(255,255,255,0.25)' }}
        onClick={signOut}
      >
        Sign out
      </button>
    </div>
  );
}
