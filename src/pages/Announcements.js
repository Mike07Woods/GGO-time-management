// src/pages/Announcements.js
// Announcements + read receipts.
//   USER / MANAGER -> read only: can view announcements aimed at them and
//                     acknowledge (mark read). No create button.
//   ADMIN / OWNER  -> can post announcements and see read-receipt counts.

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { Megaphone } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { sendPush } from '../lib/pushNotifications';
import { SkeletonList } from '../components/Skeleton';

const TARGET_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'user', label: 'Users' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Admins' },
  { value: 'owner', label: 'Owners' },
];

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Announcements() {
  const { user, profile } = useAuth();
  const { canCreate } = useRole();
  const toast = useToast();

  // Only admins/owners may post announcements (managers are read-only).
  const canPost = canCreate('announcement');

  const [announcements, setAnnouncements] = useState([]);
  const [readIds, setReadIds] = useState(new Set()); // announcements *I* have read
  const [readCounts, setReadCounts] = useState({}); // id -> total reads (posters only)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ title: '', body: '', target_role: '' });
  const [posting, setPosting] = useState(false);

  const myRole = profile?.role || 'user';

  async function loadData() {
    setLoading(true);

    // Announcements aimed at everyone (null target) or at my role.
    const annRes = await supabase
      .from('announcements')
      .select('*')
      .or(`target_role.is.null,target_role.eq.${myRole}`)
      .order('created_at', { ascending: false });

    if (annRes.error) setError(annRes.error.message);
    const list = annRes.data || [];
    setAnnouncements(list);

    // Which of these have I read?
    const myReads = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', user.id);
    setReadIds(new Set((myReads.data || []).map((r) => r.announcement_id)));

    // Read-receipt counts are only shown to those who can post (admin/owner).
    if (canPost && list.length > 0) {
      const ids = list.map((a) => a.id);
      const allReads = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .in('announcement_id', ids);
      const counts = {};
      (allReads.data || []).forEach((r) => {
        counts[r.announcement_id] = (counts[r.announcement_id] || 0) + 1;
      });
      setReadCounts(counts);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (user) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, myRole]);

  // Record a read receipt (ignores duplicates thanks to the unique constraint).
  async function markRead(announcementId) {
    setError('');
    const { error } = await supabase
      .from('announcement_reads')
      .upsert(
        { announcement_id: announcementId, user_id: user.id },
        { onConflict: 'announcement_id,user_id', ignoreDuplicates: true }
      );
    if (error) {
      toast.error(error.message);
      return;
    }
    setReadIds((prev) => new Set(prev).add(announcementId));
    setReadCounts((prev) => ({
      ...prev,
      [announcementId]: (prev[announcementId] || 0) + 1,
    }));
  }

  // Post a new announcement (admin/owner only).
  async function postAnnouncement(e) {
    e.preventDefault();
    setError('');
    if (!canPost) return; // belt-and-braces guard
    if (!form.title || !form.body) {
      setError('Title and message are required.');
      return;
    }
    setPosting(true);
    const { data, error } = await supabase
      .from('announcements')
      .insert({
        title: form.title,
        body: form.body,
        target_role: form.target_role || null,
        created_by: user.id,
      })
      .select()
      .single();
    setPosting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAnnouncements((prev) => [data, ...prev]);
    setForm({ title: '', body: '', target_role: '' });
    toast.success('Announcement posted');

    // Best-effort push to everyone it targets (except the poster).
    let pq = supabase.from('profiles').select('id').eq('is_active', true);
    if (data.target_role) pq = pq.eq('role', data.target_role);
    const { data: people } = await pq;
    sendPush(supabase, {
      user_ids: (people || []).map((p) => p.id).filter((id) => id !== user.id),
      title: 'New Announcement',
      body: data.title,
      url: '/announcements',
      tag: 'announcement',
      pref: 'announcements',
    });
  }

  const unreadCount = useMemo(
    () => announcements.filter((a) => !readIds.has(a.id)).length,
    [announcements, readIds]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1><Megaphone size={20} /> Announcements</h1>
          <p>{unreadCount} unread</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Post form — admin/owner only */}
      {canPost && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card__title">Post an announcement</div>
          <form onSubmit={postAnnouncement}>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Holiday schedule update"
              />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea
                className="textarea"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Write your announcement…"
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label>Audience</label>
                <select
                  className="select"
                  value={form.target_role}
                  onChange={(e) => setForm({ ...form, target_role: e.target.value })}
                >
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" className="btn btn--primary" disabled={posting}>
                  {posting ? 'Posting…' : 'Post announcement'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Announcement list */}
      {loading ? (
        <SkeletonList />
      ) : announcements.length === 0 ? (
        <div className="card">
          <div className="empty-state">No announcements yet.</div>
        </div>
      ) : (
        announcements.map((a) => {
          const haveRead = readIds.has(a.id);
          return (
            <div key={a.id} className={'list-item' + (haveRead ? '' : ' list-item--unread')}>
              <div className="list-item__body">
                <div className="row row--between">
                  <div className="list-item__title">{a.title}</div>
                  <span className={'badge ' + (a.target_role ? 'badge--purple' : 'badge--gray')}>
                    {a.target_role ? a.target_role : 'everyone'}
                  </span>
                </div>
                <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {a.body}
                </div>
                <div className="list-item__meta row row--between">
                  <span>{formatDate(a.created_at)}</span>
                  <span className="row" style={{ gap: 14 }}>
                    {/* Only posters (admin/owner) see the read count */}
                    {canPost && <span>👁 {readCounts[a.id] || 0} read</span>}
                    {haveRead ? (
                      <span className="badge badge--green">✓ Read</span>
                    ) : (
                      <button className="btn btn--ghost btn--sm" onClick={() => markRead(a.id)}>
                        Mark as read
                      </button>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
