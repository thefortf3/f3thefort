const BASE = 'http://localhost:3000';

// First, delete all existing entries
const listRes = await fetch(`${BASE}/api/submissions?limit=1000`);
const listData = await listRes.json();

for (const entry of listData.items) {
  await fetch(`${BASE}/api/submissions/${entry.id}`, {
    method: 'DELETE',
    headers: { 'Cookie': 'adminAuth=test123' },
  });
}

console.log(`Cleared ${listData.items.length} existing entries\n`);

// Now seed with correct sections
const entries = [
  {
    title: 'The Murph',
    leader: 'Chiclets',
    start_date: '2026-05-25T06:30',
    end_time: '2026-05-25T08:00',
    location: 'Nation Ford HS',
    description: `<p>Come ready to honor the fallen the right way — no man left behind.</p>`,
    link: '',
    section: 'whats-hot',
  },
  {
    title: 'Post Murph Invergence',
    leader: 'Shady',
    start_date: '2026-05-25T07:15',
    end_time: '2026-05-25T09:00',
    location: 'Nation Ford HS',
    description: `<p>Invergence following Murph &amp; &gt;</p>
      <ol>
        <li>AAR (After Action Report) from Greater Than.</li>
        <li>Hear from your brothers their before and after.</li>
        <li>Biggest takeaways and how this lights a fire for the Fort.</li>
      </ol>`,
    link: '',
    section: 'whats-hot',
  },
  {
    title: "Father's Day Dads & 2.0's Event",
    leader: 'NASA / Suplex / Spectre',
    start_date: '2026-06-20T09:00',
    end_time: '2026-06-20T11:00',
    location: 'WEP',
    description: `<p>9-10 Kickball with 2.0's on Fathers day at WEP. Finale will include Water balloon fight &amp; Ice Pops. Show your 2.0's why you do F3</p>`,
    link: 'https://drive.google.com/file/d/1Kdn6Sj-Qw483soMf1XJXokYXLdA7MGDt/view?usp=drive_link',
    section: 'whats-hot',
  },
  {
    title: "Bethel Men's Shelter",
    leader: 'Float Bridge',
    start_date: '2026-06-04T17:30',
    end_time: '2026-06-04T19:30',
    location: '1232 Curtis St.',
    description: `<p>The Fort supports the Bethel Men's Shelter in Rock Hill by providing a meal to the homeless men in the area. Every month a different shield lock leads the meal planning but need the support of the PAX, including Ms and 2.0s to make it happen! Signups are in the <a href="https://f3thefort.slack.com/archives/C040E2ZA943">#bethelshelters</a> channel!.</p>`,
    link: 'https://maps.app.goo.gl/GRNss7W5MujKXFWd9',
    section: 'individual-init',
  },
  {
    title: 'Adopt A Highway (2nd Quarter)',
    leader: 'Fogerty',
    start_date: '2026-06-06T08:00',
    end_time: '2026-06-06T10:00',
    location: 'Harris Street Park',
    description: `<p>Second pickup for 2026! Please save the date and help spread the word during COT. More details to follow. All supplies provided - only need you and approximately 2 hours.</p>`,
    link: '',
    section: 'individual-init',
  },
  {
    title: '11th Annual TEC Dowling Memorial Tournament',
    leader: 'Pusher',
    start_date: '2026-06-11T09:00',
    end_time: '2026-06-11T12:30',
    location: 'Palisades Country Club',
    description: `<p>We are excited to invite you to our 11th annual tournament on Thursday, June 11th at the Palisades Country Club, with a 9:00 AM shotgun start. This is FFMS's largest fundraiser of the year and honors the legacy of TEC Dowling, Superintendent of Fort Mill Schools from 1997-2005. Since its inception, the tournament has raised more than $300,000 to support technology, school supplies, and other critical needs across our schools.</p>`,
    link: 'https://www.foundationforfortmillschools.org/ffmsgolftour/page.html',
    section: 'individual-init',
  },
  {
    title: 'The Granddaddy of all CSAUPS - 2026 BRR',
    leader: 'Pusher',
    start_date: '2026-09-11T08:00',
    end_time: '2026-09-11T14:00',
    location: '',
    description: `<p>Join your F3 the Fort brothers in completing one of the most challenging CSAUPs you will undertake and register via the preblast.</p>`,
    link: 'https://f3thefort.com/2025/11/25/the-grandaddy-of-all-csaups-brr-2026/',
    section: 'individual-init',
  },
  {
    title: 'Weekly Happy Hour?',
    leader: 'Double D',
    start_date: '2026-05-22T14:30',
    end_time: '2026-05-22T16:00',
    location: 'Amor Artis',
    description: `<p>Why? Because all work and no play makes pax a dull boy. Come sharpen yourself in a conversation that lasts longer than 2 breaths in the Gloom.</p>`,
    link: '',
    section: 'still-fresh',
  },
  {
    title: "3rd F - May Theme: Integrity",
    leader: 'Cornerstone',
    start_date: '2026-05-01T00:00',
    end_time: '',
    location: '',
    description: `<p>Integrity is being the same man everywhere — no masks, no shortcuts, no excuses. It's alignment between what you say, what you do, and who you are when no one's watching. This month is about closing the gaps — between intention and action, belief and behavior. Real integrity shows up under pressure. It's easy to talk standards; it's harder to live them when it costs you something. That includes how you lead your family, how you handle conflict, and how you steward your body — because discipline in one area reinforces discipline in all areas. When the whole man is aligned, trust follows.</p>`,
    link: 'https://f3thefort.com/2026/02/01/3rd-f-word-of-the-month-for-april-sacrifice/',
    section: 'still-fresh',
  },
  {
    title: 'Q Schedule (GloomSchedule)',
    leader: '',
    start_date: '',
    end_time: '',
    location: '',
    description: `<p>View and manage your Q schedule.</p>`,
    link: 'https://app.gloomschedule.com/',
    section: 'helpful-links',
  },
  {
    title: 'FNG Capture Form',
    leader: '',
    start_date: '',
    end_time: '',
    location: '',
    description: `<p>Form for capturing new FNGs.</p>`,
    link: 'https://f3nation.us10.list-manage.com/track/click?u=31d40047f4100a853e297353d&id=a95c2b0ba1&e=c677564300',
    section: 'helpful-links',
  },
  {
    title: 'Q 101 Template',
    leader: '',
    start_date: '',
    end_time: '',
    location: '',
    description: `<p>Template for Q 101.</p>`,
    link: 'https://docs.google.com/document/d/1zFiVyspf1Xph6GIv-r-z5brONWUzhEYrBvXzbnKfdBc/edit?usp=sharing',
    section: 'helpful-links',
  },
  {
    title: 'F3TheFort LinkedIn',
    leader: '',
    start_date: '',
    end_time: '',
    location: '',
    description: `<p>Connect with F3 The Fort on LinkedIn.</p>`,
    link: 'https://www.linkedin.com/groups/7456081',
    section: 'helpful-links',
  },
  {
    title: 'Slack Access Request',
    leader: '',
    start_date: '',
    end_time: '',
    location: '',
    description: `<p>Request access to the F3 The Fort Slack workspace.</p>`,
    link: 'https://join.slack.com/t/f3thefort/shared_invite/zt-1endaagqa-nu0mQwqSr373Ib_aoZqVvg',
    section: 'helpful-links',
  },
  {
    title: 'Submit Newsletter Entries',
    leader: '',
    start_date: '',
    end_time: '',
    location: '',
    description: `<p>Submit entries for the weekly newsletter.</p>`,
    link: 'https://f3nation.us10.list-manage.com/track/click?u=31d40047f4100a853e297353d&id=f9cf1218ef&e=c677564300',
    section: 'helpful-links',
  },
];

let success = 0;
let failed = 0;

for (const entry of entries) {
  const body = {
    title: entry.title,
    start_date: entry.start_date || '2026-01-01T00:00',
    description: entry.description,
    leader: entry.leader || null,
    end_time: entry.end_time || null,
    location: entry.location || null,
    link: entry.link || null,
    section: entry.section,
  };

  try {
    const res = await fetch(`${BASE}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`✓ ${entry.title} → ${entry.section} (id: ${data.id})`);
      success++;
    } else {
      const err = await res.json();
      console.log(`✗ ${entry.title}: ${err.error}`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ ${entry.title}: ${e.message}`);
    failed++;
  }
}

console.log(`\nDone: ${success} created, ${failed} failed`);
