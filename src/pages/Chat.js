// src/pages/Chat.js
// Phase 3 — Team Chat.
// Two panels: conversation list (left) + message thread (right). Messages arrive
// live via a single Supabase Realtime subscription on chat_messages: the open
// channel appends in place, other channels bump their unread badge.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { supabase } from '../supabaseClient';

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

function formatTime(value) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Chat() {
  const { user } = useAuth();
  const { isManager } = useRole();

  const [channels, setChannels] = useState([]);
  const [people, setPeople] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState({}); // channel_id -> count
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);

  // On mobile we show the conversation list OR the thread, not both.
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Refs so the realtime handler always sees current values (avoids stale closures).
  const activeRef = useRef(null);
  const channelIdsRef = useRef(new Set());
  const bottomRef = useRef(null);

  const nameById = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Member';
    });
    return map;
  }, [people]);

  const channelLabel = useCallback(
    (ch) => {
      if (ch.type === 'direct') {
        const other = (ch.members || []).find((m) => m !== user.id);
        return nameById[other] || 'Direct message';
      }
      return ch.name || 'Group channel';
    },
    [nameById, user.id]
  );

  // Load the people directory (for names + starting DMs).
  // Uses the sanitized profiles_public view so non-managers can resolve names
  // without access to the full directory.
  useEffect(() => {
    supabase
      .from('profiles_public')
      .select('id, first_name, last_name, avatar_url')
      .eq('is_active', true)
      .order('first_name', { ascending: true })
      .then(({ data }) => setPeople(data || []));
  }, []);

  // Load my channels + unread counts.
  const loadChannels = useCallback(async () => {
    const { data, error } = await supabase
      .from('chat_channels')
      .select('*')
      .contains('members', [user.id])
      .order('created_at', { ascending: false });
    if (error) {
      setError(error.message);
      return;
    }
    const list = data || [];
    setChannels(list);
    channelIdsRef.current = new Set(list.map((c) => c.id));

    // Unread = messages from others not yet read, grouped by channel.
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

  // Mark a channel's incoming messages as read.
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

  // Open a channel: load its thread + clear unread.
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

  // Single realtime subscription for ALL new messages in my channels.
  useEffect(() => {
    const sub = supabase
      .channel('chat-stream-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new;
        if (!channelIdsRef.current.has(msg.channel_id)) return; // not my channel

        if (msg.channel_id === activeRef.current) {
          // Append to the open thread (dedupe by id) and mark read.
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.sender_id !== user.id) markRead(msg.channel_id);
        } else if (msg.sender_id !== user.id) {
          setUnread((prev) => ({ ...prev, [msg.channel_id]: (prev[msg.channel_id] || 0) + 1 }));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [user.id, markRead]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !activeId) return;
    setDraft('');
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ channel_id: activeId, sender_id: user.id, content })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    // Optimistic append (realtime will dedupe by id).
    setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
  }

  // Start (or reuse) a direct channel with another person.
  async function startDirect(otherId) {
    setError('');
    const { data: existing } = await supabase
      .from('chat_channels')
      .select('*')
      .eq('type', 'direct')
      .contains('members', [user.id, otherId]);
    const match = (existing || []).find((c) => (c.members || []).length === 2);
    if (match) {
      await loadChannels();
      openChannel(match.id);
      return;
    }
    const { data, error } = await supabase
      .from('chat_channels')
      .insert({ type: 'direct', created_by: user.id, members: [user.id, otherId] })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    await loadChannels();
    openChannel(data.id);
  }

  // Create a group channel (managers+).
  async function createGroup(e) {
    e.preventDefault();
    setError('');
    if (!groupName || groupMembers.length === 0) {
      setError('A group needs a name and at least one member.');
      return;
    }
    const members = Array.from(new Set([user.id, ...groupMembers]));
    const { data, error } = await supabase
      .from('chat_channels')
      .insert({ type: 'group', name: groupName, created_by: user.id, members })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    setShowNewGroup(false);
    setGroupName('');
    setGroupMembers([]);
    await loadChannels();
    openChannel(data.id);
  }

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team Chat {totalUnread > 0 && <span className="badge badge--red">{totalUnread}</span>}</h1>
          <p>Direct messages and group channels.</p>
        </div>
        {isManager && (
          <button className="btn btn--secondary" onClick={() => setShowNewGroup((s) => !s)}>
            + New group
          </button>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* New group form */}
      {showNewGroup && isManager && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__title">Create a group channel</div>
          <form onSubmit={createGroup}>
            <div className="field">
              <label>Channel name</label>
              <input
                className="input"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Front Desk Team"
              />
            </div>
            <div className="field">
              <label>Members (Ctrl/Cmd-click to multi-select)</label>
              <select
                multiple
                className="select"
                style={{ minHeight: 120 }}
                value={groupMembers}
                onChange={(e) =>
                  setGroupMembers(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
              >
                {people
                  .filter((p) => p.id !== user.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameById[p.id]}
                    </option>
                  ))}
              </select>
            </div>
            <button className="btn btn--primary">Create channel</button>
          </form>
        </div>
      )}

      {/* Chat layout */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', height: '68vh' }}>
          {/* Left: conversations (hidden on mobile while a thread is open) */}
          {(!isMobile || !activeId) && (
          <div
            style={{
              width: isMobile ? '100%' : 280,
              borderRight: isMobile ? 'none' : '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <div style={{ padding: 14, borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
              Conversations
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {channels.length === 0 ? (
                <div className="dim" style={{ padding: 16, fontSize: 13 }}>
                  No conversations yet. Start one below.
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
                      background: ch.id === activeId ? 'var(--surface-2)' : 'transparent',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {ch.type === 'group' ? '#' : initials(channelLabel(ch))}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {channelLabel(ch)}
                    </span>
                    {unread[ch.id] > 0 && <span className="badge badge--red">{unread[ch.id]}</span>}
                  </button>
                ))
              )}
            </div>
            {/* Start a direct message */}
            <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
              <label className="dim" style={{ fontSize: 12 }}>
                New direct message
              </label>
              <select
                className="select"
                value=""
                onChange={(e) => e.target.value && startDirect(e.target.value)}
              >
                <option value="">Choose a person…</option>
                {people
                  .filter((p) => p.id !== user.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameById[p.id]}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          )}

          {/* Right: thread (on mobile, only when a conversation is open) */}
          {(!isMobile || activeId) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!activeId ? (
              <div className="empty-state" style={{ margin: 'auto' }}>
                Select a conversation to start chatting.
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: 14,
                    borderBottom: '1px solid var(--border)',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  {isMobile && (
                    <button
                      onClick={() => setActiveId(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 18 }}
                      aria-label="Back to conversations"
                    >
                      ←
                    </button>
                  )}
                  {channelLabel(channels.find((c) => c.id === activeId) || {})}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                  {messages.length === 0 ? (
                    <div className="dim" style={{ fontSize: 13 }}>No messages yet — say hello!</div>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === user.id;
                      const senderName = nameById[m.sender_id] || 'Unknown';
                      return (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex',
                            gap: 10,
                            marginBottom: 14,
                            flexDirection: mine ? 'row-reverse' : 'row',
                          }}
                        >
                          <span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                            {initials(senderName)}
                          </span>
                          <div style={{ maxWidth: '70%' }}>
                            <div
                              className="dim"
                              style={{ fontSize: 11, marginBottom: 3, textAlign: mine ? 'right' : 'left' }}
                            >
                              {mine ? 'You' : senderName} · {formatTime(m.created_at)}
                            </div>
                            <div
                              style={{
                                background: mine ? 'var(--teal)' : 'var(--surface-2)',
                                color: mine ? '#042b27' : 'var(--text)',
                                padding: '9px 12px',
                                borderRadius: 12,
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
                  style={{ display: 'flex', gap: 10, padding: 14, borderTop: '1px solid var(--border)' }}
                >
                  <input
                    className="input"
                    placeholder="Type a message…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button className="btn btn--primary" type="submit">
                    Send
                  </button>
                </form>
              </>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
