# Performance / Egress & Realtime Notes

Supabase Free plan. ~17 users, ~65 MB DB. Keep egress and Realtime message
volume low. **Before touching presence, realtime subscriptions, or list queries,
read this file** — a small change here can re-introduce a large leak.

## The one rule that matters most
**Never re-fetch a whole table in a Realtime handler, and never broadcast the
60-second presence heartbeat to every client.** That combination caused an
N-squared traffic storm (see history below).

---

## Realtime subscriptions (keep this list accurate)

| File | Channel | Kind | Table / event | Filter | Notes |
|---|---|---|---|---|---|
| `context/PresenceContext.js` | `presence-status` | **broadcast** | `event: 'status'` | n/a | Disposition changes only. Sender broadcasts on `setMyStatus`; others patch one row. Heartbeats are NOT broadcast. |
| `components/Navbar.js` | `navbar-notifications-<uid>` | postgres_changes | `notifications` `*` | ✅ `user_id=eq.<uid>` | Unread badge. Filtered — fine. |
| `pages/Notifications.js` | (notifications) | postgres_changes | `notifications` `*` | ✅ `user_id=eq.<uid>` | Inbox. Filtered — fine. |
| `pages/Chat.js` | `chat-...` | postgres_changes | `chat_messages` INSERT | ❌ none (client-side guard) | Delivers every message to every client; discarded client-side if not a member. Low volume; acceptable but see "Not fixed". |
| `components/ChatPopup.js` | `chatpopup-...` | postgres_changes | `chat_messages` INSERT | ❌ none (client-side guard) | Same, mounted app-wide. |

**Realtime publication (`supabase_realtime`) currently contains:** `chat_messages`,
`notifications`. **Removed:** `user_presence`, `status_pings`
(see `supabase-presence-realtime-fix.sql`). Do **not** re-add `user_presence` —
heartbeats would broadcast N² again.

## Polling intervals (`setInterval`)

| File | Interval | Work | Scope |
|---|---|---|---|
| `context/PresenceContext.js` | 60s | write own `last_active_at`, poll all presence (columns only), overrun self-check | 1 small query/client — **not** N². Do not lower below 60s. |
| `components/DepartmentClockBoard.js` | 30s | dept profiles + open `time_entries` | monitor only, while Time Clock open |
| `pages/TeamStatus.js` | 60s | `time_entry_breaks` (today) | while page open |
| `pages/TeamStatus.js` | 30s | re-render tick (no fetch) | display only |
| `pages/TimeClock.js` | 1s | re-render tick (no fetch) | clock display only |

## Presence design (why it's cheap now)
- **Disposition change** → optimistic local update + one `upsert` + one
  **broadcast** (`presence-status`). Other clients patch that single row → they
  see it in ~1–2s. No full-table refetch.
- **Heartbeat (60s)** → updates `last_active_at` only, on a table that is **not**
  in the Realtime publication → no broadcast. A 60s poll refreshes everyone's
  `last_active_at` so "closed the app → Offline after ~5 min" still works.
- `fetchAllPresence` selects explicit columns, never `select('*')`.

---

## History — the leak we fixed (do not reintroduce)
9 days, 17 users → **8.68 GB egress, 1.4M Realtime messages**, quota exceeded.

Cause: `user_presence` was in the Realtime publication with a `*`/no-filter
subscription whose handler ran `fetchAllPresence = select('*')`. Every 60s
heartbeat from every user broadcast to all clients, and each client
re-downloaded the whole table → ~289 full-table fetches/min and ~416k realtime
msgs/day. Fixed in commit `85f59f9` + `supabase-presence-realtime-fix.sql`.

## Estimated before / after
| Metric | Before | After |
|---|---|---|
| Egress | ~1 GB/day | **< ~80 MB/day** (60s presence poll of ~17 small rows × ~17 clients, plus normal navigation) |
| Realtime messages | ~416k/day | **~a few k/day** (disposition broadcasts + chat + notifications only) |

## Found but NOT fixed (with reasoning)
- **Chat realtime has no server-side `filter`** — every message reaches every
  client and is discarded client-side. Left as-is: chat volume for ~17 users is
  tiny (thousands of msgs/day at most vs. presence's hundreds of thousands), so
  it is not a quota driver. A proper fix needs a dynamic `channel_id=in.(...)`
  filter rebuilt when channels change.
- **Chat loads full channel history** (`select('*')`, no `.limit()`). Left as-is
  to honor "no UI/feature behavior change": capping to the last N messages hides
  older ones unless we add "load older" scroll UI. Low egress impact at current
  volume. Revisit with pagination if a channel grows very large.
- **`select('*')` in some list views** (Directory, Announcements, Events,
  Dashboard, AuditLog `limit(1000)`): moderate payloads, not a quota driver after
  the presence fix. Tightening to explicit columns is safe future cleanup.
- **No client-side query cache** (app doesn't use react-query): re-navigation
  re-fetches. Minor; could add a light cache later without a new dependency.
