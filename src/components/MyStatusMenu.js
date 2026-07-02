// src/components/MyStatusMenu.js
// Header control letting ANY signed-in user set their own presence status. Shows
// a colored dot for the current status; clicking opens a dropdown of all statuses
// (plus an optional custom note when the org allows it). Reads/writes through the
// global PresenceProvider. Renders nothing until presence is enabled.

import React, { useEffect, useRef, useState } from 'react';
import { usePresence } from '../context/PresenceContext';

export default function MyStatusMenu() {
  const { enabled, statusTypes, myPresence, statusById, setMyStatus, settings } = usePresence();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const ref = useRef(null);

  // Keep the note field in sync with the server value.
  useEffect(() => {
    setNote(myPresence?.custom_note || '');
  }, [myPresence]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!enabled) return null;

  const current = myPresence ? statusById(myPresence.status_type_id) : null;
  const color = current?.color || '#6B7280';

  const pick = (st) => {
    setMyStatus(st.id, settings.allow_custom_notes ? note : undefined);
    setOpen(false);
  };
  const saveNote = () => {
    if (current) setMyStatus(current.id, note);
  };

  return (
    <div className="mystatus" ref={ref}>
      <style>{`
        .mystatus { position: relative; }
        .mystatus__btn {
          background: none; border: none; cursor: pointer; padding: 6px;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .mystatus__dot {
          width: 12px; height: 12px; border-radius: 50%;
          box-shadow: 0 0 0 2px var(--bg-card);
        }
        .mystatus__menu {
          position: absolute; right: 0; top: calc(100% + 8px);
          width: 220px; background: var(--bg-card);
          border: 1px solid var(--border-color); border-radius: var(--radius);
          box-shadow: 0 14px 40px rgba(0,0,0,0.35); padding: 8px; z-index: 2600;
        }
        .mystatus__title {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-muted); padding: 4px 8px 8px;
        }
        .mystatus__opt {
          display: flex; align-items: center; gap: 9px; width: 100%;
          background: none; border: none; cursor: pointer; text-align: left;
          padding: 8px; border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 14px;
        }
        .mystatus__opt:hover { background: rgba(127,127,127,0.12); }
        .mystatus__check { margin-left: auto; color: var(--text-secondary); }
        .mystatus__note { padding: 8px 6px 4px; border-top: 1px solid var(--border-color); margin-top: 6px; }
        .mystatus__note .input { font-size: 13px; }
      `}</style>

      <button
        className="mystatus__btn"
        title={current ? `Status: ${current.name}` : 'Set your status'}
        aria-label="Set your status"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mystatus__dot" style={{ background: color }} />
      </button>

      {open && (
        <div className="mystatus__menu">
          <div className="mystatus__title">Set your status</div>
          {statusTypes.map((st) => (
            <button key={st.id} className="mystatus__opt" onClick={() => pick(st)}>
              <span className="mystatus__dot" style={{ background: st.color }} />
              <span>
                {st.emoji} {st.name}
              </span>
              {current?.id === st.id && <span className="mystatus__check">✓</span>}
            </button>
          ))}
          {settings.allow_custom_notes && (
            <div className="mystatus__note">
              <input
                className="input"
                placeholder="Add a note…"
                maxLength={80}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    saveNote();
                    setOpen(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
