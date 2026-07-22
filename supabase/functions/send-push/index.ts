// supabase/functions/send-push/index.ts
// Sends a Web Push notification to one or more users' devices.
// Body: { user_ids: string[], title, body, url?, tag?, requireInteraction?, pref? }
//   pref  - optional notification_preferences column; recipients with that
//           preference set to false are skipped (a missing row = allowed).
// Deploy:  supabase functions deploy send-push
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL

import webpush from 'npm:web-push@3.6.7';

webpush.setVapidDetails(
  Deno.env.get('VAPID_EMAIL') || 'mailto:admin@ggo.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function rest(path: string, init?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  try {
    const { user_ids, title, body, url, tag, requireInteraction, pref } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0) return json({ sent: 0 });

    // Filter recipients by preference (missing row => allowed).
    let recipients: string[] = user_ids;
    if (pref) {
      const prefs =
        (await rest(
          `notification_preferences?user_id=in.(${user_ids.join(',')})&select=user_id,${pref}`
        )) || [];
      const disabled = new Set(prefs.filter((p: any) => p[pref] === false).map((p: any) => p.user_id));
      recipients = user_ids.filter((id: string) => !disabled.has(id));
    }
    if (recipients.length === 0) return json({ sent: 0 });

    const subs =
      (await rest(
        `push_subscriptions?user_id=in.(${recipients.join(',')})&select=id,endpoint,p256dh,auth`
      )) || [];

    const payload = JSON.stringify({ title, body, url, tag, requireInteraction });

    const results = await Promise.allSettled(
      subs.map((s: any) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      )
    );

    // Clean up dead subscriptions (410 Gone / 404 Not Found).
    const dead: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const code = (r.reason && (r.reason.statusCode || r.reason.status)) || 0;
        if (code === 404 || code === 410) dead.push(subs[i].id);
      }
    });
    if (dead.length) {
      await rest(`push_subscriptions?id=in.(${dead.join(',')})`, { method: 'DELETE' });
    }

    return json({ sent: results.filter((r) => r.status === 'fulfilled').length, total: results.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
