import mailchimp from '@mailchimp/mailchimp_marketing';

const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_FROM_NAME = process.env.MAILCHIMP_FROM_NAME || 'The Fort Weekly';
const MAILCHIMP_FROM_EMAIL = process.env.MAILCHIMP_FROM_EMAIL || 'newsletter@thefort.org';
const MAILCHIMP_PREVIEW_EMAIL = process.env.MAILCHIMP_PREVIEW_EMAIL;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER || 'us10';

if (!MAILCHIMP_API_KEY || !MAILCHIMP_LIST_ID) {
  console.warn('[mailchimp] MAILCHIMP_API_KEY or MAILCHIMP_LIST_ID not set — campaign endpoints will be disabled');
}

function initClient() {
  if (!MAILCHIMP_API_KEY) return;

  mailchimp.setConfig({
    apiKey: MAILCHIMP_API_KEY,
    server: MAILCHIMP_SERVER,
  });
}

initClient();

/**
 * Create a Mailchimp campaign draft with custom HTML content (does not send).
 * Returns { campaignId, status } on success.
 */
export async function createDraftCampaign(htmlContent, options = {}) {
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_LIST_ID) {
    throw new Error('Mailchimp not configured: set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID');
  }

  const { subject, title, issueDate } = options;

  const subjectLine = subject || `The Fort Weekly — ${issueDate || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  const campaignTitle = title || `Fort Weekly ${issueDate || new Date().toISOString().slice(0, 10)}`;

  const campaign = {
    type: 'regular',
    from_name: MAILCHIMP_FROM_NAME,
    from_email: MAILCHIMP_FROM_EMAIL,
    recipients: { list_id: MAILCHIMP_LIST_ID },
    settings: {
      subject_line: subjectLine,
      title: campaignTitle,
      from_name: MAILCHIMP_FROM_NAME,
      from_email: MAILCHIMP_FROM_EMAIL,
      reply_to: MAILCHIMP_FROM_EMAIL,
      email_style: 'regular',
      campaign_rating: 0,
    },
  };

  let result;
  try {
    result = await mailchimp.campaigns.create(campaign);
  } catch (err) {
    const detail = err.response?.data?.detail;
    const fieldErrors = err.response?.data?.errors?.map(e => e.message).join('; ');
    const msg = detail || fieldErrors || err.message || JSON.stringify(err);
    throw new Error(`Mailchimp campaign creation failed: ${msg}`);
  }

  const campaignId = result.id;

  // Set the HTML content for the campaign
  try {
    await mailchimp.campaigns.setContent(campaignId, { html: htmlContent });
  } catch (err) {
    // Clean up the campaign if content setting fails
    try {
      await mailchimp.campaigns.remove(campaignId);
    } catch {}
    const detail = err.response?.data?.detail;
    const fieldErrors = err.response?.data?.errors?.map(e => e.message).join('; ');
    const msg = detail || fieldErrors || err.message || JSON.stringify(err);
    throw new Error(`Mailchimp content set failed: ${msg}`);
  }

  return {
    campaignId,
    status: 'draft',
    from_name: MAILCHIMP_FROM_NAME,
    from_email: MAILCHIMP_FROM_EMAIL,
    subject: subjectLine,
  };
}

/**
 * Send a preview email with the generated newsletter HTML.
 */
export async function sendPreviewEmail(htmlContent, toEmail) {
  if (!MAILCHIMP_API_KEY) {
    throw new Error('Mailchimp not configured');
  }

  const campaign = {
    type: 'regular',
    from_name: MAILCHIMP_FROM_NAME,
    from_email: MAILCHIMP_FROM_EMAIL,
    recipients: { list_id: MAILCHIMP_LIST_ID },
    settings: {
      subject_line: 'Newsletter Preview',
      title: 'Newsletter Preview',
      from_name: MAILCHIMP_FROM_NAME,
      from_email: MAILCHIMP_FROM_EMAIL,
      reply_to: MAILCHIMP_FROM_EMAIL,
      email_style: 'regular',
      campaign_rating: 0,
      test_email: toEmail,
    },
  };

  let result;
  try {
    result = await mailchimp.campaigns.create(campaign);
  } catch (err) {
    const detail = err.response?.data?.detail;
    const fieldErrors = err.response?.data?.errors?.map(e => e.message).join('; ');
    const msg = detail || fieldErrors || err.message || JSON.stringify(err);
    throw new Error(`Mailchimp campaign creation failed: ${msg}`);
  }

  const campaignId = result.id;

  try {
    await mailchimp.campaigns.setContent(campaignId, { html: htmlContent });
  } catch (err) {
    try {
      await mailchimp.campaigns.remove(campaignId);
    } catch {}
    const detail = err.response?.data?.detail;
    const fieldErrors = err.response?.data?.errors?.map(e => e.message).join('; ');
    const msg = detail || fieldErrors || err.message || JSON.stringify(err);
    throw new Error(`Mailchimp content set failed: ${msg}`);
  }

  // Send test email to preview address
  try {
    await mailchimp.campaigns.sendTest(campaignId, { test_emails: [toEmail] });
  } catch (err) {
    try {
      await mailchimp.campaigns.remove(campaignId);
    } catch {}
    const detail = err.response?.data?.detail;
    const fieldErrors = err.response?.data?.errors?.map(e => e.message).join('; ');
    const msg = detail || fieldErrors || err.message || JSON.stringify(err);
    throw new Error(`Mailchimp send test failed: ${msg}`);
  }

  return { campaignId, status: 'preview_sent' };
}

/**
 * Check Mailchimp configuration status.
 */
export function getConfigStatus() {
  return {
    configured: !!(MAILCHIMP_API_KEY && MAILCHIMP_LIST_ID),
    hasPreviewEmail: !!MAILCHIMP_PREVIEW_EMAIL,
    fromName: MAILCHIMP_FROM_NAME,
    fromEmail: MAILCHIMP_FROM_EMAIL,
  };
}

function mcError(err) {
  const body = err.response?.body || err.response?.data || {};
  const fieldErrors = body.errors?.map(e => e.message).join('; ');
  return body.detail || fieldErrors || err.message || JSON.stringify(err);
}

function getNextSundayInfo() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;

  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);

  const y = sunday.getFullYear();
  const m = sunday.getMonth();
  const d = sunday.getDate();
  const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 8pm Central Time (CDT = UTC-5). Date.UTC handles hour overflow (25 → 01:00 next day).
  const utcOffset = parseInt(process.env.MAILCHIMP_UTC_OFFSET || '5');
  const scheduleTime = new Date(Date.UTC(y, m, d, 20 + utcOffset, 0, 0)).toISOString();

  return { dateStr, scheduleTime };
}

export function getNextSundayDateStr() {
  return getNextSundayInfo().dateStr;
}

async function findCampaignForDate(dateStr) {
  const titleToFind = `Fort Weekly ${dateStr}`;
  const response = await mailchimp.campaigns.list({ count: 200 });
  return response.campaigns?.find(c => c.settings?.title === titleToFind) || null;
}

/**
 * Returns the status of the Mailchimp campaign for a given date (YYYY-MM-DD).
 * Used to determine whether the button should read "Create" or "Update".
 */
export async function getCampaignStatusForDate(dateStr) {
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_LIST_ID) {
    return { configured: false };
  }

  const { scheduleTime } = getNextSundayInfo();

  try {
    const campaign = await findCampaignForDate(dateStr);
    return {
      configured: true,
      exists: !!campaign,
      campaignId: campaign?.id || null,
      status: campaign?.status || null,
      scheduleTime,
    };
  } catch (err) {
    return { configured: true, exists: false, error: mcError(err) };
  }
}

/**
 * Create or update the Mailchimp campaign for next Sunday at 8pm CT,
 * populating it with the given HTML and scheduling it.
 */
export async function upsertScheduledCampaign(htmlContent, options = {}) {
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_LIST_ID) {
    throw new Error('Mailchimp not configured: set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID');
  }

  const { dateStr, scheduleTime } = getNextSundayInfo();
  const [y, mo, d] = dateStr.split('-').map(Number);
  const humanDate = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

  const subjectLine = options.subject || `The Fort Weekly — ${humanDate}`;
  const campaignTitle = `Fort Weekly ${dateStr}`;

  let existing;
  try {
    existing = await findCampaignForDate(dateStr);
  } catch (err) {
    throw new Error(`Failed to search campaigns: ${mcError(err)}`);
  }

  let campaignId;
  let action;

  if (existing) {
    if (existing.status === 'sending' || existing.status === 'sent') {
      throw new Error(`Campaign is already ${existing.status} and cannot be updated.`);
    }

    campaignId = existing.id;
    action = 'updated';

    if (existing.status === 'schedule') {
      try {
        await mailchimp.campaigns.unschedule(campaignId);
      } catch (err) {
        throw new Error(`Failed to unschedule campaign: ${mcError(err)}`);
      }
    }

    try {
      await mailchimp.campaigns.update(campaignId, {
        settings: {
          subject_line: subjectLine,
          title: campaignTitle,
          from_name: MAILCHIMP_FROM_NAME,
          from_email: MAILCHIMP_FROM_EMAIL,
          reply_to: MAILCHIMP_FROM_EMAIL,
        },
      });
    } catch (err) {
      throw new Error(`Failed to update campaign: ${mcError(err)}`);
    }

    try {
      await mailchimp.campaigns.setContent(campaignId, { html: htmlContent });
    } catch (err) {
      throw new Error(`Failed to update campaign content: ${mcError(err)}`);
    }
  } else {
    let result;
    try {
      result = await mailchimp.campaigns.create({
        type: 'regular',
        recipients: { list_id: MAILCHIMP_LIST_ID },
        settings: {
          subject_line: subjectLine,
          title: campaignTitle,
          from_name: MAILCHIMP_FROM_NAME,
          from_email: MAILCHIMP_FROM_EMAIL,
          reply_to: MAILCHIMP_FROM_EMAIL,
        },
      });
    } catch (err) {
      throw new Error(`Failed to create campaign: ${mcError(err)}`);
    }

    campaignId = result.id;
    action = 'created';

    try {
      await mailchimp.campaigns.setContent(campaignId, { html: htmlContent });
    } catch (err) {
      try { await mailchimp.campaigns.remove(campaignId); } catch {}
      throw new Error(`Failed to set campaign content: ${mcError(err)}`);
    }
  }

  try {
    await mailchimp.campaigns.schedule(campaignId, { schedule_time: scheduleTime });
  } catch (err) {
    throw new Error(`Failed to schedule campaign: ${mcError(err)}`);
  }

  return { campaignId, action, dateStr, scheduleTime, status: 'scheduled' };
}
