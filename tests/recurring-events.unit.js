import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecurringEventsSection, submissionsToUpcomingEvents, todayIsoDate } from '../scripts/generate-newsletter.mjs';

// 2026-10-18 is a Sunday.
const TODAY = '2026-10-18';
const ev = (event_date, name, extra = {}) => ({ event_date, name, position: 0, ...extra });

test('shows events from today through 7 days out, and nothing outside that window', () => {
  const html = buildRecurringEventsSection([
    ev('2026-10-17', 'Yesterday'),
    ev('2026-10-18', 'Today'),
    ev('2026-10-25', 'Day seven'),
    ev('2026-10-26', 'Day eight'),
  ], TODAY);
  assert.match(html, /Today/);
  assert.match(html, /Day seven/);
  assert.doesNotMatch(html, /Yesterday/);
  assert.doesNotMatch(html, /Day eight/);
});

test('renders nothing when no event falls in the window', () => {
  assert.equal(buildRecurringEventsSection([], TODAY), '');
  assert.equal(buildRecurringEventsSection([ev('2026-12-25', 'Far away'), ev(null, 'Undated')], TODAY), '');
});

test('orders chronologically across dates and by position within a date', () => {
  const html = buildRecurringEventsSection([
    ev('2026-10-24', 'Saturday B', { position: 5 }),
    ev('2026-10-20', 'Tuesday'),
    ev('2026-10-24', 'Saturday A', { position: 2 }),
  ], TODAY);
  const order = ['Tuesday', 'Saturday A', 'Saturday B'].map(n => html.indexOf(n));
  assert.ok(order.every(i => i > -1));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // One date row per distinct date, labelled with weekday + date
  assert.equal((html.match(/class="recurring-day"/g) || []).length, 2);
  assert.match(html, /Tue<span class="recurring-day-date">Oct 20</);
  assert.match(html, /Sat<span class="recurring-day-date">Oct 24</);
});

test('crosses month and year boundaries', () => {
  const html = buildRecurringEventsSection([ev('2027-01-03', 'New year')], '2026-12-31');
  assert.match(html, /Sun<span class="recurring-day-date">Jan 3</);
});

test('escapes text and only emits http(s) detail links', () => {
  const html = buildRecurringEventsSection([
    ev('2026-10-19', '<b>Name</b>', { blurb: 'a & b', link_url: 'https://example.com/?a=1&b=2' }),
    ev('2026-10-19', 'Sneaky', { link_url: 'javascript:alert(1)' }),
  ], TODAY);
  assert.match(html, /&lt;b&gt;Name&lt;\/b&gt;/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /javascript:/);
});

test("todayIsoDate reads the date in the newsletter's timezone, not UTC", () => {
  // 02:00 UTC on Oct 19 is still the evening of Oct 18 in New York.
  assert.equal(todayIsoDate(new Date('2026-10-19T02:00:00Z')), '2026-10-18');
  assert.equal(todayIsoDate(new Date('2026-10-19T12:00:00Z')), '2026-10-19');
});

const sub = (over) => ({ title: 'Big Event', section: 'whats-hot', show_in_upcoming: 1, start_date: '2026-10-24', start_time: '0700', end_time: null, location: 'The Armory', position: 0, ...over });

test('opted-in What\'s Hot / Individual Initiative entries become "Details below" rows', () => {
  const rows = submissionsToUpcomingEvents([sub(), sub({ title: 'Solo Thing', section: 'individual-init' })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].blurb, 'Details below');
  const html = buildRecurringEventsSection(rows, TODAY);
  assert.match(html, /Big Event/);
  assert.match(html, /Details below/);
  assert.match(html, /@ The Armory/);
});

test('entries that did not opt in, or are in other sections, are ignored', () => {
  const rows = submissionsToUpcomingEvents([
    sub({ show_in_upcoming: 0 }),
    sub({ section: 'still-fresh' }),
    sub({ section: null }),
  ]);
  assert.deepEqual(rows, []);
});

test('undated entries are skipped; legacy ISO start_date supplies date and time', () => {
  const rows = submissionsToUpcomingEvents([
    sub({ start_date: '' }),
    sub({ title: 'Legacy', start_date: '2026-10-25T06:30', start_time: null, end_time: '07:15' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_date, '2026-10-25');
  assert.equal(rows[0].time, '0630-0715');
});

test('opted-in entries outside the 7-day window do not appear; hand-entered events sort first on a shared date', () => {
  const rows = [
    ...submissionsToUpcomingEvents([sub({ title: 'Too Far', start_date: '2026-12-01' }), sub({ title: 'From Submission' })]),
    ev('2026-10-24', 'Hand Entered', { position: 3 }),
  ];
  const html = buildRecurringEventsSection(rows, TODAY);
  assert.doesNotMatch(html, /Too Far/);
  assert.ok(html.indexOf('Hand Entered') < html.indexOf('From Submission'));
});
