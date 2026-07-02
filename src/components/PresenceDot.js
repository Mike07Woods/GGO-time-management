// src/components/PresenceDot.js
// Small colored presence indicator for the bottom-right of an avatar. Reads live
// presence from the global PresenceProvider — no extra DB calls. Place inside a
// position:relative avatar container. Renders nothing until presence is enabled
// (migration run), so it degrades gracefully.

import React from 'react';
import { usePresence } from '../context/PresenceContext';

export default function PresenceDot({ userId, size = 11 }) {
  const { enabled, allPresence, statusById } = usePresence();
  if (!enabled || !userId) return null;

  const pres = allPresence[userId];
  const status = pres ? statusById(pres.status_type_id) : null;
  const color = status?.color || '#6B7280'; // no presence row => Offline gray

  return (
    <span
      title={status?.name || 'Offline'}
      style={{
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        border: '2px solid var(--bg-card)',
        boxSizing: 'content-box',
      }}
    />
  );
}
