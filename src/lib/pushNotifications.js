// src/lib/pushNotifications.js
// Client helpers for Web Push: subscribe the browser and persist the
// subscription in Supabase so the send-push Edge Function can reach this device.

// True if this browser can do Web Push at all.
export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// VAPID public key must be provided at build time.
export function pushConfigured() {
  return Boolean(process.env.REACT_APP_VAPID_PUBLIC_KEY);
}

// Convert the URL-safe base64 VAPID key to the Uint8Array the API expects.
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Subscribe this browser to push (reusing an existing subscription if present).
export async function subscribeToPush() {
  if (!pushSupported() || !pushConfigured()) return null;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.REACT_APP_VAPID_PUBLIC_KEY),
  });
}

// Request permission, subscribe, and store the subscription for this user.
// Returns true on success. Safe to call repeatedly.
export async function requestAndSavePushSubscription(userId, supabase) {
  if (!pushSupported() || !pushConfigured()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const sub = await subscribeToPush();
  if (!sub) return false;

  const {
    endpoint,
    keys: { p256dh, auth },
  } = sub.toJSON();

  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint, p256dh, auth, user_agent: navigator.userAgent },
    { onConflict: 'user_id,endpoint' }
  );
  return !error;
}

// Current Notification permission ('granted' | 'denied' | 'default' | 'unsupported').
export function pushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

// Fire a push via the send-push Edge Function. Best-effort — never throws into
// the caller's UI flow. `payload`: { user_ids, title, body, url?, tag?, pref? }.
export async function sendPush(supabase, payload) {
  try {
    if (!payload?.user_ids?.length) return;
    await supabase.functions.invoke('send-push', { body: payload });
  } catch (e) {
    /* delivery is best-effort; the in-app notification is the source of truth */
  }
}
