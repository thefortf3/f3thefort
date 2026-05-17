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

  // Extract server prefix from API key (e.g., 'apikey-us18' → 'us18')
  const serverMatch = MAILCHIMP_API_KEY.match(/apikey-(.+)/i);
  const server = serverMatch ? serverMatch[1] : 'us1';

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
