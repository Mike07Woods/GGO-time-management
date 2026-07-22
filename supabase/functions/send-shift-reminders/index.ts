// supabase/functions/send-shift-reminders/index.ts
// Cron target: run every minute. Pushes a reminder to the assigned user for any
// published shift starting in ~30 or ~15 minutes. Delegates delivery (and the
// shift_reminders preference check) to the send-push function.
//
// Deploy:  supabase functions deploy send-shift-reminders
// Schedule (Supabase Dashboard -> Edge Functions -> Cron, or pg_cron):
//   every minute -> invoke this function.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function rest(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function sendPush(payload: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function remindWindow(fromMin: number, toMin: number, minutesLabel: number) {
  const now = Date.now();
  const gt = new Date(now + fromMin * 60000).toISOString();
  const lte = new Date(now + toMin * 60000).toISOString();
  const shifts = await rest(
    `shifts?status=eq.published&assigned_to=not.is.null&start_time=gt.${gt}&start_time=lte.${lte}&select=id,title,assigned_to,start_time`
  );
  for (const s of shifts) {
    await sendPush({
      user_ids: [s.assigned_to],
      title: 'Upcoming Shift',
      body: `${s.title || 'Your shift'} starts in ${minutesLabel} minutes`,
      url: '/scheduling',
      tag: `shift-${s.id}-${minutesLabel}`,
      pref: 'shift_reminders',
    });
  }
  return shifts.length;
}

Deno.serve(async () => {
  try {
    const thirty = await remindWindow(29, 30, 30);
    const fifteen = await remindWindow(14, 15, 15);
    return new Response(JSON.stringify({ reminded: thirty + fifteen }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
