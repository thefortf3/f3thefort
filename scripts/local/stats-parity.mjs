// Parity check: the Fort Stats plugin's JSON vs the Flask stats app's, endpoint by endpoint.
//
//   node scripts/local/stats-parity.mjs [FLASK_BASE] [WP_API_BASE]
//
// Defaults: the local stack (docker-compose.local.yml, profile "stats"), both on the same data:
//   Flask  http://127.0.0.1:8091/api
//   WP     http://127.0.0.1:8088/wp-json/fort-stats/v1
// Live: node scripts/local/stats-parity.mjs https://stats.f3thefort.com/api https://f3thefort.com/wp-json/fort-stats/v1
//
// Compares status codes and JSON, ignoring "generated_at" and int/float spelling (12 vs 12.0).
// Ranked lists that differ only in which of several equal-ranked people comes first (the SQL has no
// tie-breaker, so either database may return ties in any order) are reported as "ties", not as
// differences. Exits 1 on any real difference. Node 18+ (fetch).

const FLASK = (process.argv[2] || 'http://127.0.0.1:8091/api').replace(/\/$/, '');
const WP = (process.argv[3] || 'http://127.0.0.1:8088/wp-json/fort-stats/v1').replace(/\/$/, '');

const get = async (url) => {
  const t = Date.now();
  const r = await fetch(url);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, ms: Date.now() - t };
};

const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'generated_at') o[k] = strip(x);
    return o;
  }
  return v;
};

// Ranked rows with the people swapped but the same numbers: equal-ranked rows (ties) at a cut-off
// or in a list, which the SQL may return in any order. Identity fields are ignored.
const IDENTITY = new Set(['user_id', 'f3_name', 'rn', 'qs', 'coqs', 'name', 'ao_id']);
const tieKey = (x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => !IDENTITY.has(k))))
  : JSON.stringify(x);

// The first difference between a and b, as "path: a ≠ b"; null when equal. mode: 'exact',
// 'loose' (lists compared as sets), or 'ties' (lists compared by their non-identity fields).
function diff(a, b, path = '$', mode = 'exact') {
  const loose = mode === 'loose';
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 ? null : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: ${a.length} items ≠ ${b.length} items`;
    if (mode === 'ties' && a.length && typeof a[0] === 'object' && a[0] !== null && ('user_id' in a[0] || 'f3_name' in a[0])) {
      for (let i = 0; i < a.length; i++) if (tieKey(a[i]) !== tieKey(b[i])) return `${path}[${i}]: ${tieKey(a[i])} ≠ ${tieKey(b[i])}`;
      return null;
    }
    if (loose) {
      const key = (x) => JSON.stringify(x);
      const as = a.map(key).sort(), bs = b.map(key).sort();
      for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return `${path}: items differ (e.g. ${as[i].slice(0, 120)} vs ${bs[i].slice(0, 120)})`;
      return null;
    }
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`, mode); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: keys ${JSON.stringify(ka.filter((k) => !kb.includes(k)))} only in Flask, ${JSON.stringify(kb.filter((k) => !ka.includes(k)))} only in WP`;
    for (const k of ka) { const d = diff(a[k], b[k], `${path}.${k}`, mode); if (d) return d; }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)?.slice(0, 120)} ≠ ${JSON.stringify(b)?.slice(0, 120)}`;
}

const paths = [
  '/core', '/streaks',
  '/month/2026-10', '/month/2026-09', '/month/2025-12', '/month/2024-02', '/month/2019-02', '/month/2013-08',
  '/month/2026-13', '/month/oct',
  '/backblasts', '/backblasts?days=8&limit=4', '/backblasts?days=31&limit=50', '/backblasts?days=1&limit=1', '/backblasts?days=99&limit=0',
  '/backblasts/summary',
  '/backblasts/archive', '/backblasts/archive?page=2', '/backblasts/archive?page=300', '/backblasts/archive?page=365', '/backblasts/archive?page=9999',
  '/backblasts/archive?per_page=60', '/backblasts/archive?ao=Alcatraz', '/backblasts/archive?month=2019-02', '/backblasts/archive?ao=Block%20Party&month=2025-06',
  '/backblasts/archive?type=Ruck', '/backblasts/archive?q=murph', '/backblasts/archive?q=100%25', '/backblasts/archive?q=a_b', '/backblasts/archive?q=%E2%80%99',
  '/backblasts/archive?month=Oct%202026', '/backblasts/archive?q=zzzznotfound',
  '/backblasts/1', '/schedule?days=2', '/fng', '/fng-challenge',
];

// About 20 single backblasts from across the archive.
const sample = await get(`${FLASK}/backblasts/archive?per_page=1&page=1`);
const total = sample.json?.total || 0;
for (let i = 0; i < 20 && total; i++) {
  const page = 1 + Math.floor((i * (total - 1)) / 19);
  const one = await get(`${FLASK}/backblasts/archive?per_page=1&page=${page}`);
  const id = one.json?.items?.[0]?.event_id;
  if (id) paths.push(`/backblasts/${id}`);
}

let same = 0, orderOnly = 0, different = 0;
for (const p of paths) {
  const [f, w] = await Promise.all([get(FLASK + p), get(WP + p)]);
  let verdict, detail = '';
  if (f.status !== w.status) {
    verdict = 'DIFF'; detail = `status ${f.status} ≠ ${w.status}`;
  } else if (f.json === null || w.json === null) {
    verdict = f.text === w.text ? 'same' : 'DIFF'; detail = verdict === 'DIFF' ? 'not JSON' : '';
  } else {
    const d = diff(strip(f.json), strip(w.json));
    if (!d) verdict = 'same';
    else if (!diff(strip(f.json), strip(w.json), '$', 'loose') || !diff(strip(f.json), strip(w.json), '$', 'ties')) { verdict = 'ties'; detail = d; }
    else { verdict = 'DIFF'; detail = diff(strip(f.json), strip(w.json), '$', 'ties'); }
  }
  if (verdict === 'same') same++; else if (verdict === 'ties') orderOnly++; else different++;
  console.log(`${verdict.padEnd(5)} ${String(f.status).padEnd(4)} ${p}  (flask ${f.ms} ms, wp ${w.ms} ms)${detail ? '\n      ' + detail : ''}`);
}
console.log(`\n${same} same, ${orderOnly} differ only in which of several equal-ranked rows comes first (ties), ${different} different (of ${paths.length}).`);
process.exit(different ? 1 : 0);
