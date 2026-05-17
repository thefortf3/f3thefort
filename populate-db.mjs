import { request } from 'http';

const BASE = 'http://localhost:3000';
const ADMIN_PASSWORD = 'test123';

function httpFetch(path, options = {}) {
  const url = new URL(path, BASE);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function main() {
  console.log('=== Newsletter DB Population Script ===\n');

  // --- Phase 0: Clean existing entries ---
  console.log('[Phase 0] Cleaning existing entries...\n');
  const cleanRes = await httpFetch('/api/submissions?limit=1000', { method: 'GET' });
  const cleanData = JSON.parse(cleanRes.body);
  if (cleanData.items && cleanData.items.length > 0) {
    for (const entry of cleanData.items) {
      await httpFetch(`/api/submissions/${entry.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
      });
      console.log(`  Deleted entry ${entry.id}: "${entry.title}"`);
    }
    console.log(`  Cleaned ${cleanData.items.length} existing entries.\n`);
  } else {
    console.log('  No existing entries to clean.\n');
  }

  // Small delay after cleanup
  await new Promise(r => setTimeout(r, 500));

  // --- Phase 1: Create entries WITHOUT sections ---
  console.log('[Phase 1] Creating entries (no sections)...\n');

  const entries = [
    // WHATS HOT
    {
      title: 'The Murph',
      leader: 'Chiclets',
      start_date: '2026-05-25T06:30',
      location: 'Nation Ford HS',
      description: '<p>Come ready to honor the fallen the right way — no man left behind.</p>',
    },
    {
      title: 'Post Murph Invergence',
      leader: 'Shady',
      start_date: '2026-05-25T07:15',
      location: 'Nation Ford HS',
      description: '<p>Invergence following Murph &amp; &gt; AAR from Greater Than. Hear from your brothers their before and after. Biggest takeaways and how this lights a fire for the Fort.</p>',
    },
    {
      title: "Father's Day Dads & 2.0's Event",
      leader: 'NASA / Suplex / Spectre',
      start_date: '2026-06-20T09:00',
      location: 'WEP',
      description: '<p>9-10 Kickball with 2.0\'s on Fathers day at WEP. Finale will include Water balloon fight &amp; Ice Pops. Show your 2.0\'s why you do F3.</p>',
    },
    // INDIVIDUAL INIT
    {
      title: "Bethel Men's Shelter",
      leader: 'Float Bridge',
      start_date: '2026-05-07T17:30',
      end_time: '2026-05-07T19:30',
      location: '1232 Curtis St., Rock Hill',
      description: '<p>The Fort supports the Bethel Men\'s Shelter in Rock Hill by providing a meal to the homeless men in the area. Every month a different shield lock leads the meal planning. Signups are in the #bethelshelters channel!</p>',
    },
    {
      title: 'Adopt A Highway (2nd Quarter)',
      leader: 'Fogerty',
      start_date: '2026-06-06T08:00',
      location: 'Harris Street Park',
      description: '<p>Second pickup for 2026! Please save the date and help spread the word during COT. All supplies provided - only need you and approximately 2 hours. SYITG</p>',
    },
    {
      title: '11th Annual TEC Dowling Memorial Tournament',
      leader: 'Pusher',
      start_date: '2026-06-11T09:00',
      end_time: '2026-06-11T12:30',
      location: 'Palisades Country Club',
      description: '<p>The 11th annual tournament on Thursday, June 11th at the Palisades Country Club, with a 9:00 AM shotgun start. FFMS\'s largest fundraiser of the year, honoring the legacy of TEC Dowling. Raised more than $300,000 to support technology, school supplies, and other critical needs across our schools.</p>',
      link: 'https://www.foundationforfortmillschools.org/ffmsgolftour/page.html',
    },
    {
      title: 'The Granddaddy of all CSAUPS - 2026 BRR',
      leader: 'Pusher',
      start_date: '2026-09-11T09:00',
      location: 'TBD - register via preblast',
      description: '<p>Join your F3 the Fort brothers in completing one of the most challenging CSAUPs you will undertake. Register via the preblast.</p>',
      link: 'https://f3thefort.com/2025/11/25/the-grandaddy-of-all-csaups-brr-2026/',
    },
    // STILL FRESH
    {
      title: 'Weekly Happy Hour?',
      leader: 'Double D',
      start_date: '2026-05-22T14:30',
      location: 'Amor Artis',
      description: '<p>Why? Because all work and no play makes pax a dull boy. Come sharpen yourself in a conversation that lasts longer than 2 breaths in the Gloom.</p>',
    },
    {
      title: '3rd F - May Theme: Integrity',
      leader: 'Cornerstone',
      start_date: '2026-05-01T00:00',
      description: '<p>Integrity is being the same man everywhere — no masks, no shortcuts, no excuses. It\'s alignment between what you say, what you do, and who you are when no one\'s watching. Real integrity shows up under pressure.</p>',
      link: 'https://f3thefort.com/2026/02/01/3rd-f-word-of-the-month-for-april-sacrifice/',
    },
  ];

  const createdIds = [];
  for (const entry of entries) {
    const res = await httpFetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: entry,
    });
    const data = JSON.parse(res.body);
    createdIds.push(data.id);
    console.log(`  Created: "${entry.title}" (id=${data.id})`);
  }
  console.log(`\n  Total created: ${createdIds.length}\n`);

  // Small delay before section assignment
  await new Promise(r => setTimeout(r, 500));

  // --- Phase 2: Assign sections via admin PATCH ---
  console.log('[Phase 2] Assigning sections via admin PATCH...\n');

  const sectionAssignments = [
    // whats-hot (indices 0-2)
    { id: createdIds[0], section: 'whats-hot' },
    { id: createdIds[1], section: 'whats-hot' },
    { id: createdIds[2], section: 'whats-hot' },
    // individual-init (indices 3-6)
    { id: createdIds[3], section: 'individual-init' },
    { id: createdIds[4], section: 'individual-init' },
    { id: createdIds[5], section: 'individual-init' },
    { id: createdIds[6], section: 'individual-init' },
    // still-fresh (indices 7-8)
    { id: createdIds[7], section: 'still-fresh' },
    { id: createdIds[8], section: 'still-fresh' },
  ];

  for (const assignment of sectionAssignments) {
    const res = await httpFetch(`/api/submissions/${assignment.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `adminAuth=${ADMIN_PASSWORD}`,
      },
      body: { section: assignment.section },
    });
    const data = JSON.parse(res.body);
    const sectionLabel = assignment.section ? assignment.section.replace(/-/g, ' ') : 'null';
    console.log(`  Patched id=${assignment.id} -> section: ${sectionLabel}`);
  }

  // --- Phase 3: Verify ---
  console.log('\n[Phase 3] Verifying final state...\n');

  const finalRes = await httpFetch('/api/submissions?limit=100', { method: 'GET' });
  const finalData = JSON.parse(finalRes.body);
  console.log(`  Total entries in DB: ${finalData.pagination.total}`);
  console.log('');

  const sections = {};
  for (const item of finalData.items) {
    const sec = item.section || 'unclassified';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(item.title);
  }

  for (const [sec, titles] of Object.entries(sections)) {
    console.log(`  ${sec} (${titles.length}):`);
    for (const t of titles) {
      console.log(`    - ${t}`);
    }
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
