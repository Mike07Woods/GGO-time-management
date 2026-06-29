// src/components/ChatPopup.js
// Floating chat widget shown on every authenticated page.
//   - bubble button (bottom-right) with unread badge
//   - compact panel: conversation list <-> message thread
//   - realtime messages + toast notification for incoming messages on any page
// Self-contained: own data + realtime subscription. Chat.js page is untouched.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../supabaseClient';

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ChatPopup() {
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState([]);
  const [people, setPeople] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState({});
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState(null); // { channelId, name, text }

  // Refs so the realtime handler reads current values.
  const openRef = useRef(false);
  const activeRef = useRef(null);
  const channelIdsRef = useRef(new Set());
  const bottomRef = useRef(null);
  const toastTimer = useRef(null);

  openRef.current = open;
  activeRef.current = activeId;

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Member';
    });
    return map;
  }, [people]);

  const channelLabel = useCallback(
    (ch) => {
      if (!ch) return '';
      if (ch.type === 'direct') {
        const other = (ch.members || []).find((m) => m !== user.id);
        return nameById[other] || 'Direct message';
      }
      return ch.name || 'Group channel';
    },
    [nameById, user.id]
  );

  // People directory (sanitized view) for names.
  useEffect(() => {
    supabase
      .from('profiles_public')
      .select('id, first_name, last_name, avatar_url')
      .eq('is_active', true)
      .then(({ data }) => setPeople(data || []));
  }, []);

  const loadChannels = useCallback(async () => {
    const { data } = await supabase
      .from('chat_channels')
      .select('*')
      .contains('members', [user.id])
      .order('created_at', { ascending: false });
    const list = data || [];
    setChannels(list);
    channelIdsRef.current = new Set(list.map((c) => c.id));

    const { data: unreadRows } = await supabase
      .from('chat_messages')
      .select('channel_id')
      .eq('is_read', false)
      .neq('sender_id', user.id);
    const counts = {};
    (unreadRows || []).forEach((m) => {
      counts[m.channel_id] = (counts[m.channel_id] || 0) + 1;
    });
    setUnread(counts);
  }, [user.id]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const markRead = useCallback(
    async (channelId) => {
      await supabase
        .from('chat_messages')
        .update({ is_read: true })
        .eq('channel_id', channelId)
        .neq('sender_id', user.id)
        .eq('is_read', false);
      setUnread((prev) => ({ ...prev, [channelId]: 0 }));
    },
    [user.id]
  );

  const openChannel = useCallback(
    async (channelId) => {
      setActiveId(channelId);
      activeRef.current = channelId;
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true });
      setMessages(data || []);
      markRead(channelId);
    },
    [markRead]
  );

  // Single realtime subscription for all my channels' messages.
  useEffect(() => {
    const sub = supabase
      .channel('chatpopup-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new;
        if (!channelIdsRef.current.has(msg.channel_id)) return;

        const viewingThis = openRef.current && msg.channel_id === activeRef.current;
        if (viewingThis) {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.sender_id !== user.id) markRead(msg.channel_id);
          return;
        }

        if (msg.sender_id !== user.id) {
          setUnread((prev) => ({ ...prev, [msg.channel_id]: (prev[msg.channel_id] || 0) + 1 }));
          // Toast: sender name + first 60 chars.
          const senderName = nameById[msg.sender_id] || 'New message';
          const text = (msg.content || '').slice(0, 60);
          setToast({ channelId: msg.channel_id, name: senderName, text });
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 4000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [user.id, markRead, nameById]);

  // Auto-scroll the thread.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function sendMessage(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !activeId) return;
    setDraft('');
    const { data } = await supabase
      .from('chat_messages')
      .insert({ channel_id: activeId, sender_id: user.id, content })
      .select()
      .single();
    if (data) setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
  }

  function openFromToast() {
    const cid = toast?.channelId;
    setToast(null);
    if (!cid) return;
    setOpen(true);
    openChannel(cid);
  }

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const activeChannel = channels.find((c) => c.id === activeId);

  // --- styles (brand colors; theme-aware via CSS vars where it makes sense) ---
  const wrap = { position: 'fixed', right: 20, bottom: 20, zIndex: 1000 };
  const bubble = {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#004BC8',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: 24,
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
  };
  const panel = {
    width: 350,
    height: 500,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 14,
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 12,
  };

  return (
    <div style={wrap}>
      {/* Toast */}
      {toast && (
        <button
          onClick={openFromToast}
          style={{
            display: 'block',
            textAlign: 'left',
            width: 300,
            marginBottom: 12,
            padding: '12px 14px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderLeft: '3px solid #00D15E',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            cursor: 'pointer',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{toast.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {toast.text}
            {toast.text.length >= 60 ? '…' : ''}
          </div>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div style={panel}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-color)',
              background: '#004BC8',
              color: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {activeId && (
                <button
                  onClick={() => setActiveId(null)}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16 }}
                  title="Back"
                >
                  ←
                </button>
              )}
              <strong style={{ fontSize: 15 }}>
                {activeId ? channelLabel(activeChannel) : 'Messages'}
              </strong>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
              title="Minimize"
            >
              –
            </button>
          </div>

          {/* Body: conversation list OR thread */}
          {!activeId ? (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {channels.length === 0 ? (
                <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                  No conversations yet. Start one from the Chat page.
                </div>
              ) : (
                channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => openChannel(ch.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '11px 14px',
                      border: 'none',
                      borderBottom: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {ch.type === 'group' ? '#' : initials(channelLabel(ch))}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {channelLabel(ch)}
                    </span>
                    {unread[ch.id] > 0 && (
                      <span style={{ background: '#00D15E', color: '#010101', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 7px' }}>
                        {unread[ch.id]}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                {messages.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No messages yet.</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === user.id;
                    return (
                      <div
                        key={m.id}
                        style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}
                      >
                        <div style={{ maxWidth: '78%' }}>
                          {!mine && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                              {nameById[m.sender_id] || 'Member'} · {formatTime(m.created_at)}
                            </div>
                          )}
                          <div
                            style={{
                              background: mine ? '#004BC8' : 'var(--bg-hover)',
                              color: mine ? '#fff' : 'var(--text-primary)',
                              padding: '8px 11px',
                              borderRadius: 12,
                              fontSize: 14,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {m.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>
              <form
                onSubmit={sendMessage}
                style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border-color)' }}
              >
                <input
                  className="input"
                  placeholder="Message…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" className="btn btn--primary btn--sm">
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {/* Bubble */}
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes bounce-dot {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
      <div style={{ position: 'relative', width: 56, height: 56, marginLeft: 'auto' }}>
        {/* Pulsing ring — only while the panel is closed */}
        {!open && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: '#004BC8',
              animation: 'pulse-ring 2s ease-out infinite',
              zIndex: 0,
            }}
            aria-hidden="true"
          />
        )}
        <button
          style={{ ...bubble, zIndex: 1 }}
          title={open ? 'Close chat' : 'Messages'}
          onClick={() => {
            setOpen((o) => !o);
            if (!open) loadChannels();
          }}
        >
          {open ? (
            <X size={20} color="#fff" />
          ) : (
            // Typing-indicator style: three bouncing dots
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'white',
                  animation: 'bounce-dot 1s ease-in-out infinite',
                  animationDelay: '0s',
                }}
              />
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'white',
                  animation: 'bounce-dot 1s ease-in-out infinite',
                  animationDelay: '0.15s',
                }}
              />
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'white',
                  animation: 'bounce-dot 1s ease-in-out infinite',
                  animationDelay: '0.3s',
                }}
              />
            </div>
          )}
          {totalUnread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 20,
              height: 20,
              padding: '0 5px',
              borderRadius: 10,
              background: '#00D15E',
              color: '#010101',
              fontSize: 11,
              fontWeight: 800,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
        </button>
      </div>
    </div>
  );
}
