// Approver notifications. Without SLACK_BOT_TOKEN and SLACK_APPROVAL_CHANNEL this only logs
// what it would have sent, so local runs never post to the real workspace.

function formatDates(occurrences) {
  if (!occurrences?.length) return 'No date (ongoing)';
  const fmt = (o) => {
    const d = new Date(o.date + 'T00:00:00Z');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return o.start_time ? `${label} ${o.start_time}` : label;
  };
  const shown = occurrences.slice(0, 3).map(fmt).join(', ');
  return occurrences.length > 3 ? `${shown} +${occurrences.length - 3} more` : shown;
}

export function buildSubmissionMessage(entry, adminBaseUrl) {
  const who = [entry.submitter_name, entry.submitter_email].filter(Boolean).join(' · ') || 'anonymous';
  const adminUrl = `${(adminBaseUrl || '').replace(/\/$/, '')}/admin#entry-${entry.id}`;
  const text = `New newsletter entry needs approval: ${entry.title}`;
  const lines = [
    `*${entry.title}*`,
    formatDates(entry.occurrences),
    entry.location ? `📍 ${entry.location}` : null,
    entry.leader ? `Q: ${entry.leader}` : null,
    `Submitted by ${who}`,
  ].filter(Boolean);
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `:inbox_tray: *New entry waiting for approval*\n${lines.join('\n')}` } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Review in admin' }, url: adminUrl }] },
    ],
  };
}

/** Posts the "needs approval" message. Never throws — a Slack problem must not block a submission. */
export async function notifySubmission(entry, { fetchImpl = fetch, env = process.env } = {}) {
  const message = buildSubmissionMessage(entry, env.ADMIN_BASE_URL || env.BASE_URL);
  const token = env.SLACK_BOT_TOKEN;
  const channel = env.SLACK_APPROVAL_CHANNEL;
  if (!token || !channel) {
    console.log(`[slack:dry-run] ${message.text}`);
    return { sent: false, dryRun: true };
  }
  try {
    const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, ...message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error('Slack notify failed:', data.error || res.status);
      return { sent: false, error: data.error || String(res.status) };
    }
    return { sent: true };
  } catch (err) {
    console.error('Slack notify failed:', err.message);
    return { sent: false, error: err.message };
  }
}
