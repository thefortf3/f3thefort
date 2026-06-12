import { Buffer } from 'buffer';

const BASE = process.env.WORDPRESS_BASE_URL;  // must end with /
const USER = process.env.WORDPRESS_USERNAME;
const PASS = process.env.WORDPRESS_APP_PASSWORD;
const PREBLAST_CAT = process.env.WORDPRESS_PREBLAST_CATEGORY || 'Pre-Blast';

function headers() {
  const token = Buffer.from(`${USER}:${PASS}`).toString('base64');
  return { 'Authorization': `Basic ${token}`, 'Content-Type': 'application/json' };
}

async function getIdBySearch(type, name) {
  const res = await fetch(`${BASE}${type}?per_page=100&search=${encodeURIComponent(name)}`, { headers: headers() });
  if (!res.ok) throw new Error(`WP ${type} lookup failed: ${res.status}`);
  const data = await res.json();
  return (data.find(item => item.name.toLowerCase() === name.toLowerCase()) || {}).id ?? null;
}

async function getIdFromCreate(type, name) {
  const res = await fetch(`${BASE}${type}`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`WP ${type} create failed: ${res.status}`);
  const data = await res.json();
  if (!data.id) throw new Error(`WP ${type} create returned no id`);
  return data.id;
}

async function getOrCreate(type, name) {
  const id = await getIdBySearch(type, name);
  return id ?? await getIdFromCreate(type, name);
}

function formatWorkoutDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export async function postPreblast(title, content, leader, location, startDate, eventLink) {
  if (!BASE || !USER || !PASS) throw new Error('WordPress env vars not configured');

  const preblastCatId = await getIdBySearch('categories', PREBLAST_CAT);
  if (!preblastCatId) throw new Error(`WordPress category "${PREBLAST_CAT}" not found`);

  const aoCatId = location ? await getOrCreate('categories', location) : null;
  const categories = aoCatId ? [preblastCatId, aoCatId] : [preblastCatId];

  const fullContent = eventLink
    ? `${content}\n<p><a href="${eventLink}">Event Link</a></p>`
    : content;

  const res = await fetch(`${BASE}posts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      title,
      status: 'publish',
      content: fullContent,
      categories,
      qic: leader ? leader.trim() : '',
      workout_date: formatWorkoutDate(startDate),
    }),
  });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`WP post failed: ${res.status} — ${b}`);
  }
  return (await res.json()).link;
}
