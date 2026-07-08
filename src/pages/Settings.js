// src/pages/Settings.js
// Self-service settings: edit your own profile, change your password, and pick a
// theme. Available to every authenticated user (reached from the navbar gear).

import React, { useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { Cog } from 'lucide-react';
import { supabase } from '../supabaseClient';
import StatusSettings from '../components/StatusSettings';

export default function Settings() {
  const { user, profile, refreshProfile } = useAuth();
  const toast = useToast();

  const avatarInitials =
    ((profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '')).toUpperCase() ||
    (user?.email?.[0]?.toUpperCase() ?? '?');

  // --- Avatar ---
  const fileRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2 MB.');
      return;
    }
    setUploadingAvatar(true);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) {
      setUploadingAvatar(false);
      toast.error(
        /bucket not found/i.test(upErr.message)
          ? 'Avatar storage isn’t set up yet — run supabase-avatars.sql.'
          : upErr.message
      );
      return;
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`; // cache-bust same-path re-uploads
    const { error } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
    setUploadingAvatar(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (refreshProfile) await refreshProfile();
    toast.success('Photo updated');
  }

  async function removeAvatar() {
    setUploadingAvatar(true);
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id);
    setUploadingAvatar(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (refreshProfile) await refreshProfile();
    toast.success('Photo removed');
  }

  // --- Profile ---
  const [form, setForm] = useState({
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    phone: profile?.phone || '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setSavingProfile(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        phone: form.phone || null,
      })
      .eq('id', user.id);
    setSavingProfile(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (refreshProfile) await refreshProfile();
    toast.success('Profile updated');
  }

  // --- Password ---
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  async function changePassword(e) {
    e.preventDefault();
    if (pw.next.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    if (pw.next !== pw.confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setSavingPw(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPw({ next: '', confirm: '' });
    toast.success('Password changed');
  }

  // --- Appearance ---
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.body.classList.contains('light-mode')
      ? 'light'
      : 'dark'
  );

  function applyTheme(next) {
    setTheme(next);
    document.body.className = next === 'light' ? 'light-mode' : 'dark-mode';
    try {
      localStorage.setItem('ggo-theme', next);
    } catch (e) {
      /* ignore */
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1><Cog size={20} /> Settings</h1>
          <p>Manage your profile, password and preferences.</p>
        </div>
      </div>

      <div className="grid grid--2">
        {/* Profile */}
        <div className="card">
          <div className="card__title">Profile</div>

          {/* Avatar */}
          <div className="row" style={{ gap: 16, marginBottom: 20 }}>
            <div className="avatar avatar--lg">
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : avatarInitials}
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={uploadingAvatar}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
                </button>
                {profile?.avatar_url && (
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={uploadingAvatar}
                    onClick={removeAvatar}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                JPG or PNG, up to 2 MB.
              </div>
            </div>
          </div>

          <form onSubmit={saveProfile}>
            <div className="form-row">
              <div className="field">
                <label>First name</label>
                <input
                  className="input"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Last name</label>
                <input
                  className="input"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" value={user?.email || ''} disabled />
            </div>
            <div className="field">
              <label>Role</label>
              <input className="input" value={profile?.role || '—'} disabled style={{ textTransform: 'capitalize' }} />
            </div>
            <button className="btn btn--primary" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </form>
        </div>

        <div>
          {/* Password */}
          <div className="card">
            <div className="card__title">Change password</div>
            <form onSubmit={changePassword}>
              <div className="field">
                <label>New password</label>
                <input
                  type="password"
                  className="input"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  type="password"
                  className="input"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
              <button className="btn btn--primary" disabled={savingPw}>
                {savingPw ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </div>

          {/* Appearance */}
          <div className="card">
            <div className="card__title">Appearance</div>
            <div className="row" style={{ gap: 10 }}>
              <button
                className={'btn btn--sm ' + (theme === 'dark' ? 'btn--primary' : 'btn--ghost')}
                onClick={() => applyTheme('dark')}
              >
                🌙 Dark
              </button>
              <button
                className={'btn btn--sm ' + (theme === 'light' ? 'btn--primary' : 'btn--ghost')}
                onClick={() => applyTheme('light')}
              >
                ☀️ Light
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Live-status configuration (owner/admin only; self-gates) */}
      <StatusSettings />
    </div>
  );
}
