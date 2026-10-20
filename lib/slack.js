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

// Everything here comes from an anonymous form. Slack's control sequences are wrapped in
// <...> (<!channel>, <@U123>, <https://evil|Click me>), so escaping &, < and > as Slack
// documents keeps a submitter from pinging the channel or disguising links. Formatting
// characters are stripped so a title can't restyle the message.
function slackText(s, max = 200) {
  return String(s ?? '').replace(/[*_~`]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildSubmissionMessage(entry, adminBaseUrl) {
  const who = slackText([entry.submitter_name, entry.submitter_email].filter(Boolean).join(' · ')) || 'anonymous';
  const adminUrl = `${(adminBaseUrl || '').replace(/\/$/, '')}/admin#entry-${Number(entry.id)}`;
  const title = slackText(entry.title, 160);
  const text = `New newsletter entry needs approval: ${title}`;
  const lines = [
    `*${title}*`,
    formatDates(entry.occurrences),
    entry.location ? `📍 ${slackText(entry.location)}` : null,
    entry.leader ? `Q: ${slackText(entry.leader, 80)}` : null,
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
