// src/pages/KnowledgeBase.js
// Phase 3 — Knowledge Base.
//   everyone: search/filter, read articles (view count increments via RPC).
//   owner/admin: create / edit / delete articles, with tags.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { supabase } from '../supabaseClient';

const EMPTY = { title: '', content: '', category: '', tags: '', is_published: true };

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { isAdmin } = useRole(); // owner/admin can author
  const toast = useToast();

  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const [selected, setSelected] = useState(null); // article being read
  const [editing, setEditing] = useState(null); // article being edited, or 'new'
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('knowledge_articles')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    setArticles(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const categories = useMemo(() => {
    const set = new Set(articles.map((a) => a.category).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [articles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (!q) return true;
      return [a.title, a.content, (a.tags || []).join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [articles, query, category]);

  // Open an article and increment its view count (RPC bypasses the admin-only
  // update policy so any reader can be counted).
  async function openArticle(article) {
    setSelected(article);
    setEditing(null);
    await supabase.rpc('increment_article_views', { article_id: article.id });
    setArticles((prev) =>
      prev.map((a) => (a.id === article.id ? { ...a, views: (a.views || 0) + 1 } : a))
    );
    setSelected((s) => (s ? { ...s, views: (s.views || 0) + 1 } : s));
  }

  function startNew() {
    setForm(EMPTY);
    setEditing('new');
    setSelected(null);
  }

  function startEdit(article) {
    setForm({
      title: article.title || '',
      content: article.content || '',
      category: article.category || '',
      tags: (article.tags || []).join(', '),
      is_published: article.is_published,
    });
    setEditing(article.id);
    setSelected(null);
  }

  async function saveArticle(e) {
    e.preventDefault();
    setError('');
    if (!form.title || !form.content) {
      setError('Title and content are required.');
      return;
    }
    setSaving(true);
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const base = {
      title: form.title,
      content: form.content,
      category: form.category || null,
      tags,
      is_published: form.is_published,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const resp =
      editing === 'new'
        ? await supabase
            .from('knowledge_articles')
            .insert({ ...base, created_by: user.id })
            .select()
            .single()
        : await supabase.from('knowledge_articles').update(base).eq('id', editing).select().single();

    setSaving(false);
    if (resp.error) {
      toast.error(resp.error.message);
      return;
    }
    toast.success(editing === 'new' ? 'Article published' : 'Article updated');
    setEditing(null);
    loadArticles();
  }

  async function deleteArticle(id) {
    setError('');
    const { error } = await supabase.from('knowledge_articles').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSelected(null);
    loadArticles();
    toast.success('Article deleted');
  }

  // ---- Editor view ----
  if (editing) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{editing === 'new' ? 'New Article' : 'Edit Article'}</h1>
          </div>
          <button className="btn btn--ghost" onClick={() => setEditing(null)}>
            ← Back
          </button>
        </div>
        {error && <div className="alert alert--error">{error}</div>}
        <div className="card">
          <form onSubmit={saveArticle}>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label>Category</label>
                <input
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. HR, IT, Policies"
                />
              </div>
              <div className="field">
                <label>Tags (comma separated)</label>
                <input
                  className="input"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="onboarding, payroll"
                />
              </div>
            </div>
            <div className="field">
              <label>Content</label>
              <textarea
                className="textarea"
                style={{ minHeight: 280 }}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
              />
              Published
            </label>
            <button className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save article'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Detail view ----
  if (selected) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{selected.title}</h1>
            <p>
              {selected.category || 'Uncategorized'} · {selected.views || 0} views
            </p>
          </div>
          <div className="row">
            <button className="btn btn--ghost" onClick={() => setSelected(null)}>
              ← Back
            </button>
            {isAdmin && (
              <>
                <button className="btn btn--secondary btn--sm" onClick={() => startEdit(selected)}>
                  Edit
                </button>
                <button className="btn btn--danger btn--sm" onClick={() => deleteArticle(selected.id)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
        <div className="card">
          {(selected.tags || []).length > 0 && (
            <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {selected.tags.map((t) => (
                <span key={t} className="badge badge--purple">
                  {t}
                </span>
              ))}
            </div>
          )}
          {!selected.is_published && (
            <div className="alert" style={{ background: 'rgba(240,160,32,0.12)', color: '#f3bb5e' }}>
              Draft — not visible to regular users.
            </div>
          )}
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 15 }}>
            {selected.content}
          </div>
        </div>
      </div>
    );
  }

  // ---- List view ----
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Knowledge Base</h1>
          <p>{articles.length} articles</p>
        </div>
        {isAdmin && (
          <button className="btn btn--primary" onClick={startNew}>
            + New article
          </button>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="Search articles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select"
            style={{ maxWidth: 200 }}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading articles…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">No articles found.</div>
        </div>
      ) : (
        <div className="grid grid--2">
          {filtered.map((a) => (
            <button
              key={a.id}
              className="card"
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => openArticle(a)}
            >
              <div className="row row--between">
                <strong>{a.title}</strong>
                {a.category && <span className="badge badge--teal">{a.category}</span>}
              </div>
              <div className="muted" style={{ margin: '8px 0', maxHeight: 48, overflow: 'hidden' }}>
                {(a.content || '').slice(0, 140)}
                {(a.content || '').length > 140 ? '…' : ''}
              </div>
              <div className="dim" style={{ fontSize: 12 }}>
                {a.views || 0} views{!a.is_published ? ' · draft' : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
