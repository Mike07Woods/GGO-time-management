// src/components/LoadingScreen.js
// Full-screen branded splash on first load. Theme-aware: white logo on a dark
// background (dark mode) or the dark logo on a light background (light mode).
// Animates the GGO mark, builds "G · G · O" in one by one, fades in the
// wordmark, runs a progress bar, then fades itself out and calls onComplete().

import React, { useEffect, useState } from 'react';
import logoIconWhite from '../assets/ggo-icon-white.png';
import logoIconBlack from '../assets/ggo-icon-black.png';

export default function LoadingScreen({ onComplete }) {
  const [fading, setFading] = useState(false);

  // Pick colors from the active theme (set on <body> by the no-flash script).
  const isLight =
    typeof document !== 'undefined' && document.body.classList.contains('light-mode');
  const bg = isLight ? '#F5F7FA' : '#0A0F1E';
  const fg = isLight ? '#0A0F1E' : '#FFFFFF';
  const muted = isLight ? 'rgba(10,15,30,0.55)' : 'rgba(255,255,255,0.6)';
  const track = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2200);
    const doneTimer = setTimeout(() => onComplete && onComplete(), 2600);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onComplete]);

  const letters = ['G', 'G', 'O'];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 4000,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <style>{`
        @keyframes ggoLetterIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ggoFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ggoMarkIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes ggoBarFill { from { width: 0%; } to { width: 100%; } }
        .ggo-letter { display: inline-block; opacity: 0; animation: ggoLetterIn 0.4s ease forwards; }
        .ggo-sep { color: #004BC8; }
      `}</style>

      {/* GGO icon (80px; white on dark, dark on light) */}
      <div style={{ animation: 'ggoMarkIn 0.5s ease forwards' }}>
        <img
          src={isLight ? logoIconBlack : logoIconWhite}
          alt="GGO"
          style={{ height: '80px', objectFit: 'contain', display: 'block' }}
        />
      </div>

      {/* G · G · O — letters build in one by one */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: fg, fontSize: '28px', fontWeight: 800, letterSpacing: '0.22em' }}>
        {letters.map((ch, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="ggo-sep">·</span>}
            <span className="ggo-letter" style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
              {ch}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Wordmark — fades in after the letters */}
      <div
        style={{
          fontSize: '12px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: muted,
          opacity: 0,
          animation: 'ggoFadeIn 0.6s ease forwards',
          animationDelay: '1.1s',
        }}
      >
        gulf global outsourcing
      </div>

      {/* Bottom progress bar — fills over 2s */}
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: '2px', background: track }}>
        <div style={{ height: '100%', background: '#004BC8', width: '0%', animation: 'ggoBarFill 2s linear forwards' }} />
      </div>
    </div>
  );
}
