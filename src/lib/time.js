// src/lib/time.js
// Pure date/hours helpers used by the time clock, timesheets and reports.
// Framework-free so they can be unit-tested directly (see time.test.js).

// Monday 00:00 (local) of the week containing `d`.
export function startOfWeek(d) {
  const date = new Date(d);
  const dow = (date.getDay() + 6) % 7; // 0 = Monday
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - dow);
  return date;
}

// Local YYYY-MM-DD (avoids the UTC shift you'd get from toISOString()).
export function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
}

// Worked hours between clock-in and clock-out, minus a completed break.
// Never negative. Accepts Date objects or date strings.
export function computeTotalHours(clockIn, clockOut, breakStart, breakEnd) {
  const inMs = new Date(clockIn).getTime();
  const outMs = new Date(clockOut).getTime();
  let breakMs = 0;
  if (breakStart && breakEnd) {
    breakMs = new Date(breakEnd).getTime() - new Date(breakStart).getTime();
  }
  const hours = (outMs - inMs - breakMs) / 3600000;
  return Math.max(0, hours);
}

// Weekly overtime = hours beyond the threshold (never negative).
export function computeOvertime(totalHours, weeklyThreshold = 40) {
  return Math.max(0, totalHours - weeklyThreshold);
}
