// Calendar-date helpers shared by the server, the newsletter generator and the public API.
// Dates are plain YYYY-MM-DD strings for the Fort's region; "today" is read in that zone
// rather than the server's (the production container runs in UTC).

export const NEWSLETTER_TZ = process.env.NEWSLETTER_TZ || 'America/New_York';

/** Today's calendar date (YYYY-MM-DD) in the newsletter's timezone. */
export function todayIsoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NEWSLETTER_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True for a real YYYY-MM-DD calendar date (rejects 2026-02-30 and friends). */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
