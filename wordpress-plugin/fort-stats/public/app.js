/* stats.f3thefort.com — SPA. Fetches /api/core on load; streaks, FNGs and
   per-month leaderboards are fetched on demand. Design ported from the old
   generated template.html. */

async function fetchJSON(url) {
  // Fort Stats (WordPress): the same API under /wp-json/fort-stats/v1 instead of /api.
  if (window.FORT_STATS_API_BASE) url = url.replace(/^\/api\//, window.FORT_STATS_API_BASE + '/');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

// Fort Stats (WordPress): chart colours and font from the theme's CSS variables, so the charts
// match the site (and its style options). Canvas can't use var() itself, so they're read here.
function themeColor(name, alpha = 1, fallback = '#8a8a82') {
  const el = document.getElementById('fort-stats') || document.documentElement;
  let v = getComputedStyle(el).getPropertyValue(name).trim() || fallback;
  if (alpha >= 1) return v;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return `color-mix(in srgb, ${v} ${Math.round(alpha * 100)}%, transparent)`;
}

const STANDING_RANGES = ['all_time', 'ytd', 'last90', 'last30'];

function app() {
  return {
    // ── load state ────────────────────────────────────────────────────────
    loaded: false,
    err: null,
    DATA: {},
    streaksLoaded: false,
    fngLoaded: false,
    fng: null,
    loadingMonth: false,
    _monthCache: {},          // 'YYYY-MM' -> {leaderboard, aos}

    // ── lookup maps (built from DATA) ─────────────────────────────────────
    paxMap: {},
    paxTopAOsMap: {},
    aoTopAttendeesMap: {},
    aoMonthlyMap: {},
    aoNoQMap: {},
    streakMap: {},

    // ── UI state ─────────────────────────────────────────────────────────
    activeTab: 'leaderboard',
    tabs: [
      { id: 'leaderboard', label: 'Leaderboard' },
      { id: 'aos',         label: 'AOs' },
      { id: 'trends',      label: 'Trends' },
      { id: 'streaks',     label: 'Streaks' },
      { id: 'fngs',        label: 'FNGs' },
    ],
    ranges: [
      { id: 'all_time', label: 'All-time' }, { id: 'ytd', label: 'YTD' },
      { id: 'last90', label: '90d' },        { id: 'last30', label: '30d' },
    ],

    lbSort: 'posts', lbRange: 'ytd', lbCoqCol: 'coq',
    searchQuery: '', highlightId: null,

    trendMode: 'monthly', trendMonths: 12,
    streakType: 'weekly_posts', fngRange: 'all_time',

    aoRange: 'ytd', aoSortCol: 'pax_posts', aoSortDir: 'desc',
    aoColumns: [
      { id: 'workouts',   label: 'Workouts',   color: 'text-slate-200', barColor: 'bg-slate-400' },
      { id: 'pax_posts',  label: 'Posts',      color: 'text-f3blue',    barColor: 'bg-f3blue' },
      { id: 'unique_pax', label: 'Unique PAX', color: 'text-gold',      barColor: 'bg-gold' },
      { id: 'avg_pax',    label: 'Avg PAX',    color: 'text-green-400', barColor: 'bg-green-400' },
    ],

    selectedPax: null, selectedAO: null, aoModalRange: 'ytd',

    trendChart: null, aoChart: null, fngChart: null,
    trendChartInited: false, fngChartInited: false,

    // ── init ─────────────────────────────────────────────────────────────
    async init() {
      if (window.Chart) Chart.defaults.font.family = themeColor('--body', 1, 'Georgia, serif');
      try {
        this.DATA = await fetchJSON('/api/core');
      } catch (e) {
        this.err = 'Could not load stats — try again in a minute.';
        console.error(e);
        return;
      }
      this.buildMaps();
      this.loaded = true;
    },

    buildMaps() {
      const D = this.DATA;
      this.paxMap = {};
      (D.pax_stats || []).forEach(p => { this.paxMap[p.user_id] = p; });

      this.paxTopAOsMap = {};
      (D.pax_top_aos || []).forEach(r => { (this.paxTopAOsMap[r.user_id] ||= []).push(r); });

      this.aoTopAttendeesMap = {};
      STANDING_RANGES.forEach(range => {
        this.aoTopAttendeesMap[range] = {};
        (D.ao_top_attendees?.[range] || []).forEach(r => {
          (this.aoTopAttendeesMap[range][r.ao_id] ||= []).push(r);
        });
      });

      this.aoMonthlyMap = {};
      (D.ao_monthly_trend || []).forEach(r => { (this.aoMonthlyMap[r.ao_id] ||= []).push(r); });

      this.aoNoQMap = {};
      (D.ao_no_q || []).forEach(r => { this.aoNoQMap[r.ao_id] = r; });

      this.streakMap = {};
      (D.weekly_streaks || []).forEach(s => { this.streakMap[s.user_id] = s; });
    },

    // ── computed ─────────────────────────────────────────────────────────
    isMonthRange(r) { return !STANDING_RANGES.includes(r); },

    _leaderboardFor(range) {
      if (STANDING_RANGES.includes(range)) return this.DATA.leaderboards?.[range] || [];
      return this._monthCache[range]?.leaderboard || [];
    },

    get sortedLeaderboard() {
      const src = [...this._leaderboardFor(this.lbRange)];
      if (this.lbSort === 'qs') {
        src.sort((a, b) => (b.qs || 0) - (a.qs || 0) || b.total_posts - a.total_posts);
      }
      return src.map((p, i) => ({ ...p, rank: i + 1 }));
    },

    get currentStreakType() {
      return this.DATA.streak_types?.find(t => t.id === this.streakType) || this.DATA.streak_types?.[0];
    },
    get currentStreakData() { return this.DATA.streaks?.[this.streakType] || []; },
    get activeStreaks() {
      return this.currentStreakData.filter(s => s.current_streak > 0)
        .sort((a, b) => b.current_streak - a.current_streak).slice(0, 20);
    },
    get recordStreaks() {
      return [...this.currentStreakData].sort((a, b) => b.max_streak - a.max_streak).slice(0, 20);
    },
    get maxActiveStreak() { return this.activeStreaks[0]?.current_streak || 1; },
    get maxRecordStreak() { return this.recordStreaks[0]?.max_streak || 1; },

    get paxTopAOs()      { return this.selectedPax ? (this.paxTopAOsMap[this.selectedPax.user_id] || []) : []; },
    get aoTopAttendees() { return this.selectedAO  ? (this.aoTopAttendeesMap[this.aoModalRange]?.[this.selectedAO.ao_id] || []) : []; },

    _aoDataFor(range) {
      if (STANDING_RANGES.includes(range)) return this.DATA.ao_data?.[range] || [];
      return this._monthCache[range]?.aos || [];
    },
    get sortedAOs() {
      const list = [...this._aoDataFor(this.aoRange)];
      const col = this.aoSortCol, dir = this.aoSortDir;
      list.sort((a, b) => {
        const va = a[col] ?? -1, vb = b[col] ?? -1;
        return dir === 'desc' ? vb - va : va - vb;
      });
      return list;
    },
    get aoMaxVal() { return Math.max(1, ...this.sortedAOs.map(a => a[this.aoSortCol] || 0)); },
    get aoSortLabel() { return this.aoColumns.find(c => c.id === this.aoSortCol)?.label || ''; },

    get ehList()    { return this.fngRange === 'ytd' ? this.fng.top_ehers_ytd : this.fng.top_ehers; },
    get byAoList()  { return this.fngRange === 'ytd' ? this.fng.by_ao_ytd     : this.fng.by_ao; },

    // ── helpers ──────────────────────────────────────────────────────────
    paxName(uid) { return this.paxMap[uid]?.f3_name || ('PAX#' + uid); },
    homeAO(uid)  { return (this.paxTopAOsMap[uid] || [])[0]?.ao_name || '—'; },
    fmtMonth(m) {
      const [y, mo] = m.split('-');
      return new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    },

    // ── range / sort / month loading ─────────────────────────────────────
    setRange(r)   { if (r) { this.lbRange = r; this.highlightId = null; this.onSearch(); } },
    setAORange(r) { if (r) this.aoRange = r; },
    toggleAOSort(col) {
      if (this.aoSortCol === col) this.aoSortDir = this.aoSortDir === 'desc' ? 'asc' : 'desc';
      else { this.aoSortCol = col; this.aoSortDir = 'desc'; }
    },

    async pickMonth(key, which) {
      if (!key) return;
      if (which === 'lb') this.lbRange = key; else this.aoRange = key;
      this.highlightId = null;
      if (!this._monthCache[key]) {
        this.loadingMonth = true;
        try { this._monthCache[key] = await fetchJSON('/api/month/' + key); }
        catch (e) { console.error(e); this._monthCache[key] = { leaderboard: [], aos: [] }; }
        this.loadingMonth = false;
      }
    },

    // ── search ───────────────────────────────────────────────────────────
    onSearch() {
      const q = this.searchQuery.toLowerCase().trim();
      if (!q) { this.highlightId = null; return; }
      const match = this.sortedLeaderboard.find(p => p.f3_name && p.f3_name.toLowerCase().includes(q));
      this.highlightId = match ? match.user_id : null;
      if (this.highlightId) {
        this.$nextTick(() => {
          document.getElementById('pax-' + this.highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    },

    // ── tabs / lazy loads ────────────────────────────────────────────────
    async switchTab(tab) {
      this.activeTab = tab;
      if (tab === 'streaks' && !this.streaksLoaded) await this.loadStreaks();
      if (tab === 'fngs' && !this.fngLoaded) await this.loadFng();
      this.$nextTick(() => {
        if (tab === 'trends' && !this.trendChartInited) { this.buildTrendChart(); this.trendChartInited = true; }
        if (tab === 'fngs' && this.fngLoaded && this.fng?.total > 0 && !this.fngChartInited) {
          this.buildFngChart(); this.fngChartInited = true;
        }
      });
    },

    async loadStreaks() {
      try {
        const d = await fetchJSON('/api/streaks');
        this.DATA.streaks = d.streaks;
      } catch (e) { console.error(e); this.DATA.streaks = {}; }
      this.streaksLoaded = true;
    },

    async loadFng() {
      try { this.fng = await fetchJSON('/api/fng'); }
      catch (e) { console.error(e); this.fng = { total: 0 }; }
      this.fngLoaded = true;
    },

    // ── modals ───────────────────────────────────────────────────────────
    openPax(uid) {
      const p = this.paxMap[uid]; if (!p) return;
      this.selectedPax = { ...p, ...(this.streakMap[uid] || {}) };
    },
    openPaxByName(name) {
      const p = (this.DATA.pax_stats || []).find(x => x.f3_name === name);
      if (p) this.openPax(p.user_id);
    },
    openAO(aoId) {
      this.selectedAO = (this.DATA.ao_data?.all_time || []).find(a => a.ao_id === aoId) || null;
      this.aoModalRange = 'ytd';
      this.$nextTick(() => this.buildAOTrendChart());
    },
    closePax() { this.selectedPax = null; },
    closeAO()  { this.selectedAO = null; if (this.aoChart) { this.aoChart.destroy(); this.aoChart = null; } },
    closeModals() { this.closePax(); this.closeAO(); },

    // ── charts ───────────────────────────────────────────────────────────
    _scales(hasY2 = false) {
      return {
        x: { ticks: { color: themeColor('--text-mute'), maxRotation: 45, font: { size: 10 } }, grid: { color: themeColor('--line-2', .5) } },
        y: { ticks: { color: themeColor('--text-mute'), font: { size: 10 } }, grid: { color: themeColor('--line-2', .5) } },
        ...(hasY2 ? { y2: { position: 'right', ticks: { color: themeColor('--amber'), font: { size: 10 } }, grid: { drawOnChartArea: false } } } : {}),
      };
    },

    _trendData() {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - this.trendMonths);
      const cut = cutoff.toISOString().slice(0, 7);

      if (this.trendMode === 'weekly') {
        const d = (this.DATA.weekly_trend || []).slice(-Math.round(this.trendMonths * 4.35));
        return { labels: d.map(w => w.week), datasets: [
          { label: 'PAX Posts', data: d.map(w => w.pax_posts), borderColor: themeColor('--accent2'), backgroundColor: themeColor('--accent2', .15), tension: .3, fill: true, yAxisID: 'y' },
          { label: 'Workouts',  data: d.map(w => w.workouts),  borderColor: themeColor('--amber'), borderDash: [4, 3], tension: .3, fill: false, yAxisID: 'y2' },
        ] };
      }
      if (this.trendMode === 'fng') {
        const d = (this.DATA.monthly_trend || []).filter(m => m.month >= cut);
        return { labels: d.map(m => m.month), datasets: [
          { label: 'FNGs', data: d.map(m => m.fngs), borderColor: themeColor('--fstats-fng', 1, '#7fb685'), backgroundColor: themeColor('--fstats-fng', .2, '#7fb685'), tension: .3, fill: true },
        ] };
      }
      const d = (this.DATA.monthly_trend || []).filter(m => m.month >= cut);
      return { labels: d.map(m => m.month), datasets: [
        { label: 'PAX Posts',  data: d.map(m => m.pax_posts),  backgroundColor: themeColor('--accent2', .7), type: 'bar',  yAxisID: 'y' },
        { label: 'Unique PAX', data: d.map(m => m.unique_pax), borderColor: themeColor('--amber'), tension: .3, fill: false, type: 'line', yAxisID: 'y' },
      ] };
    },

    buildTrendChart() {
      const ctx = document.getElementById('trendChart'); if (!ctx) return;
      if (this.trendChart) this.trendChart.destroy();
      const cfg = this._trendData();
      const hasY2 = cfg.datasets.some(d => d.yAxisID === 'y2');
      this.trendChart = new Chart(ctx, { type: 'line', data: cfg, options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: themeColor('--text-dim'), boxWidth: 12, font: { size: 11 } } } },
        scales: this._scales(hasY2),
      } });
    },
    rebuildTrendChart() { this.$nextTick(() => this.buildTrendChart()); },

    buildFngChart() {
      const ctx = document.getElementById('fngChart'); if (!ctx || !this.fng) return;
      if (this.fngChart) this.fngChart.destroy();
      const d = this.fng.monthly || [];
      this.fngChart = new Chart(ctx, { type: 'bar', data: {
        labels: d.map(r => r.month),
        datasets: [{ label: 'FNGs', data: d.map(r => r.count), backgroundColor: themeColor('--fstats-fng', .7, '#7fb685'), borderRadius: 3 }],
      }, options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, scales: this._scales(),
      } });
    },

    buildAOTrendChart() {
      const ctx = document.getElementById('aoTrendChart'); if (!ctx || !this.selectedAO) return;
      if (this.aoChart) { this.aoChart.destroy(); this.aoChart = null; }
      const rows = this.aoMonthlyMap[this.selectedAO.ao_id] || [];
      this.aoChart = new Chart(ctx, { type: 'bar', data: {
        labels: rows.map(r => r.month),
        datasets: [{ label: 'PAX Posts', data: rows.map(r => r.pax_posts), backgroundColor: themeColor('--accent2', .7) }],
      }, options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, scales: this._scales(),
      } });
    },
  };
}
