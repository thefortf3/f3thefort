import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAgenda, renderAgenda, summaryOf, imageOf } from '../lib/newsletter-agenda.js';

const TODAY = '2026-10-20'; // a Tuesday

let nextId = 1;
function entry(over = {}) {
  const occurrences = over.occurrences || [];
  const next = occurrences.find(o => o.date >= TODAY) || null;
  return {
    id: nextId++, title: 'Untitled', slug: null, status: 'approved', archived_at: null, hold_from_newsletter: false,
    featured: false, approved_at: '2026-09-01 12:00:00', tags: [], summary: '', description: '<p>desc</p>',
    location: null, leader: null, link: null, preblast_url: null, hero_image: null,
    ...over, occurrences, next_occurrence: next,
  };
}

test('only approved, unarchived, unheld entries with a future (or no) date are included', () => {
  const sel = selectAgenda([
    entry({ title: 'Approved', occurrences: [{ date: '2026-10-22' }] }),
    entry({ title: 'Pending', status: 'pending', occurrences: [{ date: '2026-10-22' }] }),
    entry({ title: 'Rejected', status: 'rejected', occurrences: [{ date: '2026-10-22' }] }),
    entry({ title: 'Held', hold_from_newsletter: true, occurrences: [{ date: '2026-10-22' }] }),
    entry({ title: 'Archived', archived_at: '2026-10-01', occurrences: [{ date: '2026-10-22' }] }),
    entry({ title: 'Past', occurrences: [{ date: '2026-10-01' }] }),
    entry({ title: 'Ongoing' }),
  ], TODAY);
  const titles = [...sel.thisWeek.flatMap(d => d.entries), ...sel.comingUp, ...sel.ongoing].map(e => e.title);
  assert.deepEqual(titles.sort(), ['Approved', 'Ongoing']);
});

test('this week = next 7 days grouped by date; everything later goes to Coming up', () => {
  const sel = selectAgenda([
    entry({ title: 'Today', occurrences: [{ date: '2026-10-20', start_time: '0515' }] }),
    entry({ title: 'Sat late', occurrences: [{ date: '2026-10-24', start_time: '1100' }] }),
    entry({ title: 'Sat early', occurrences: [{ date: '2026-10-24', start_time: '0730' }] }),
    entry({ title: 'Day 6', occurrences: [{ date: '2026-10-26' }] }),
    entry({ title: 'Day 7', occurrences: [{ date: '2026-10-27' }] }),
    entry({ title: 'Way out', occurrences: [{ date: '2027-03-01' }] }),
  ], TODAY);
  assert.deepEqual(sel.thisWeek.map(d => d.date), ['2026-10-20', '2026-10-24', '2026-10-26']);
  assert.deepEqual(sel.thisWeek[1].entries.map(e => e.title), ['Sat early', 'Sat late']);
  assert.deepEqual(sel.comingUp.map(e => e.title), ['Day 7', 'Way out']);
  assert.deepEqual(sel.range, { from: '2026-10-20', to: '2026-10-26' });
});

test('an entry appears once, at its next date, listing later dates as "also"', () => {
  const sel = selectAgenda([entry({ title: 'Bethel', occurrences: [{ date: '2026-10-01' }, { date: '2026-11-05' }, { date: '2026-12-03' }] })], TODAY);
  assert.equal(sel.comingUp.length, 1);
  assert.equal(sel.comingUp[0].next_occurrence.date, '2026-11-05');
  assert.deepEqual(sel.comingUp[0].also, ['2026-12-03']);
});

test('the featured entry moves to the Featured card and is not repeated in the agenda', () => {
  const sel = selectAgenda([
    entry({ title: 'Accelerate', featured: true }),
    entry({ title: 'Other', occurrences: [{ date: '2026-10-22' }] }),
  ], TODAY);
  assert.equal(sel.featured.title, 'Accelerate');
  assert.equal(sel.ongoing.length, 0);
  // A held featured entry is not featured in the newsletter.
  const held = selectAgenda([entry({ title: 'Held feature', featured: true, hold_from_newsletter: true })], TODAY);
  assert.equal(held.featured, null);
});

test('NEW marks entries approved within the last week', () => {
  const sel = selectAgenda([
    entry({ title: 'Fresh', approved_at: '2026-10-18 09:00:00', occurrences: [{ date: '2026-10-22' }] }),
    entry({ title: 'Old', approved_at: '2026-10-01 09:00:00', occurrences: [{ date: '2026-10-22' }] }),
  ], TODAY);
  const byTitle = Object.fromEntries(sel.thisWeek[0].entries.map(e => [e.title, e.isNew]));
  assert.deepEqual(byTitle, { Fresh: true, Old: false });
});

test('summary falls back to a word-boundary excerpt of the description; images come from hero or description', () => {
  assert.equal(summaryOf(entry({ summary: 'Short.' })), 'Short.');
  const long = summaryOf(entry({ description: `<p>${'word '.repeat(100)}</p>` }), 40);
  assert.ok(long.endsWith('…') && long.length <= 41);
  assert.equal(imageOf(entry({ description: '<p><img src="/uploads/a.png"></p>' })), '/uploads/a.png');
  assert.equal(imageOf(entry({ hero_image: '/uploads/h.png', description: '<img src="/uploads/a.png">' })), '/uploads/h.png');
});

test('render: escapes text, links entries to their site page, and fills the template', () => {
  const tpl = '<title>{{TITLE}}</title><body>{{BODY}}</body>';
  const html = renderAgenda(tpl, {
    today: TODAY,
    entries: [
      entry({ title: 'Ruck <b>and</b> Roll', slug: 'ruck-and-roll', occurrences: [{ date: '2026-10-24', start_time: '0915' }],
        tags: [{ label: 'I2', color: '#8fb4d8' }], location: 'NaFo', leader: 'Iron Man', summary: 'Teachers & cancer', link: 'javascript:alert(1)' }),
    ],
    region: {
      fngStats: { total2026: 81, goal: 226, daysElapsed: 291 },
      shovelFlags: [{ from_name: 'Deep Dish', to_name: 'Small Things', ao: 'The Hive' }],
      nantan: { text: '<p>Free workouts.</p><script>x()</script>', author: 'Band Camp' },
      threeFsItems: [{ item_type: 'event', name: 'Coffeteria', detail: 'Sat 0730' }],
      helpfulLinks: [{ label: 'Q Schedule', url: 'https://app.gloomschedule.com/' }],
      sltEntries: [{ role: "Nan'tan", name: 'Band Camp' }],
    },
  }, { siteBaseUrl: 'https://f3thefort.com', submitUrl: 'https://f3thefort.com/submit', asset: u => u, rewrite: h => h });
  assert.match(html, /<title>The Fort Weekly — week of Oct 20<\/title>/);
  assert.match(html, /Ruck &lt;b&gt;and&lt;\/b&gt; Roll/);
  assert.match(html, /href="https:\/\/f3thefort.com\/events\/ruck-and-roll"/);
  assert.match(html, /Teachers &amp; cancer/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /81<\/b>\/226 FNGs/);
  assert.match(html, /Deep Dish → Small Things @ The Hive/);
  assert.match(html, /THIS WEEK/);
  assert.match(html, /Q Schedule ↗/);
});
