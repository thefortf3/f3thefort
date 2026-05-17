#!/usr/bin/env node
/**
 * generate-newsletter.mjs
 *
 * Merges static template data (static-data.json) + submission data (dev.db)
 * into a single dark-themed HTML newsletter with red highlights.
 *
 * CLI Commands:
 *   node generate-newsletter.mjs              # Default: LLM → generate previews → interactive prompt → render both HTMLs
 *   node generate-newsletter.mjs --preview    # Generate variety plan + previews only, no final render
 *   node generate-newsletter.mjs --render     # Render both HTMLs from existing variety-plan.json
 *   node generate-newsletter.mjs --regenerate # Regenerate via LLM from scratch
 *   node generate-newsletter.mjs --no-llm     # Static mode (current behavior, no LLM)
 *   node generate-newsletter.mjs --plan FILE  # Use existing plan file
 *
 * Interactive CLI workflow (default mode):
 *   1. LLM generates variety-plan.json + newsletter-preview.html + newsletter-email.html
 *   2. Opens preview in browser
 *   3. Prompts: "Accept (A), Edit (E), Regenerate (R)?"
 *      - A: Accept → write final files
 *      - E: Open variety-plan.json in $EDITOR → after save, re-render both HTMLs, return to prompt
 *      - R: Call LLM again → new plan
 *   4. On LLM error: "LLM unavailable. Fix and run: node generate-newsletter.mjs"
 */

import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import readline from 'readline';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outputFlag = args.find(a => a.startsWith('--output=')) || args.find(a => a.startsWith('--output'));
const outputPath = outputFlag
  ? outputFlag.replace('--output=', '').replace('--output ', '')
  : resolve(__dirname, 'newsletter-dark.html');

const dbPathArg = args.find(a => a.startsWith('--db=')) || args.find(a => a.startsWith('--db'));
const dbPath = dbPathArg
  ? dbPathArg.replace('--db=', '').replace('--db ', '')
  : (process.env.TEST_DB || resolve(__dirname, 'dev.db'));

const staticDataPath = resolve(__dirname, 'static-data.json');
const varietyPlanPath = resolve(__dirname, 'variety-plan.json');
const previewOutputPath = resolve(__dirname, 'newsletter-preview.html');
const emailOutputPath = resolve(__dirname, 'newsletter-email-rendered.html');

const previewOnly = args.includes('--preview');
const renderOnly = args.includes('--render');
const noLLM = args.includes('--no-llm');
const regenerate = args.includes('--regenerate');
const autoAccept = args.includes('--auto-accept');

const planFlag = args.find(a => a.startsWith('--plan=')) || args.find(a => a === '--plan');
let customPlanPath = null;
if (planFlag) {
  if (planFlag.startsWith('--plan=')) {
    customPlanPath = planFlag.replace('--plan=', '');
  } else {
    const planIdx = args.indexOf('--plan');
    if (planIdx >= 0 && planIdx + 1 < args.length) {
      customPlanPath = args[planIdx + 1];
    }
  }
}

// ─── LLM config ──────────────────────────────────────────────────────
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://aibot:13305/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'user.Qwen3.6-35B-A3B-MOE-Thinking';
const LLM_TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || '0.7');

// ─── 1. Read static template data ────────────────────────────────────
function loadStaticData(path) {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

// ─── 2. Read submission data from database ───────────────────────────
function getSubmissions(dbPath) {
  const db = new Database(dbPath);
  const stmt = db.prepare(`
    SELECT id, title, leader, start_date, end_time, location, description, link, section
    FROM submissions
    WHERE section IS NOT NULL AND section != 'null'
    ORDER BY
      CASE section
        WHEN 'fng-tracker' THEN 0
        WHEN 'desk' THEN 1
        WHEN 'whats-hot' THEN 2
        WHEN 'individual-init' THEN 3
        WHEN 'still-fresh' THEN 4
        WHEN 'helpful-links' THEN 5
        ELSE 6
      END,
      start_date ASC
  `);
  const rows = stmt.all();
  db.close();
  return rows;
}

// ─── 3. Get FNG progress stats ───────────────────────────────────────
function getFngStats(dbPath) {
  const db = new Database(dbPath);
  const goal = 226;
  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  const daysElapsed = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
  const dailyRate = goal / 365;
  const expectedFngs = Math.floor(daysElapsed * dailyRate);

  const total2026 = db.prepare('SELECT COUNT(*) as total FROM fngs WHERE year = ?').get(currentYear);
  const totalAll = db.prepare('SELECT COUNT(*) as total FROM fngs').get();

  db.close();

  return {
    goal,
    currentYear,
    daysElapsed,
    dailyRate: Math.round(dailyRate * 100) / 100,
    expectedFngs,
    totalAll: totalAll.total,
    total2026: totalAll.total,
    remaining: Math.max(0, goal - total2026.total),
    onTrack: total2026.total >= expectedFngs,
    progressPercent: Math.round((total2026.total / goal) * 100),
  };
}

// ─── 3b. Get FNGs from the current week (Mon–Sun) ────────────────────
async function getWeeklyFngs() {
  const sheetUrl = process.env.FNG_SHEET_URL;
  if (!sheetUrl) return [];

  const response = await fetch(sheetUrl);
  if (!response.ok) return [];
  const csvText = await response.text();
  const rows = parseCSV(csvText);

  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weekStartStr = weekStart.toISOString().slice(0, 19);
  const weekEndStr = weekEnd.toISOString().slice(0, 19);

  const weekly = [];
  for (const row of rows) {
    const ts = row['Timestamp']?.trim();
    if (!ts) continue;
    const d = new Date(ts);
    if (isNaN(d.getTime())) continue;
    const dStr = d.toISOString().slice(0, 19);
    if (dStr >= weekStartStr && dStr <= weekEndStr) {
      weekly.push({
        first_name: row['First Name']?.trim() || '',
        last_name: row['Last Name']?.trim() || '',
        email: row['Email']?.trim() || '',
        f3_name: row['F3 Name']?.trim() || '',
        ehed_by: (row["EH'ed By"] || row['EHed By'] || '').trim() || '',
        ao: row['AO']?.trim() || '',
        workout_q: (row['Workout Q\'s F3 Name'] || row['Workout Q F3 Name'] || '').trim() || '',
      });
    }
  }

  return weekly;
}

// ─── CSV parser ──────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    const row = {};
    header.forEach((h, idx) => {
      row[h] = fields[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

// ─── 4. Format dates ─────────────────────────────────────────────────
function formatDate(startDate, endTime) {
  if (!startDate) return '';
  try {
    const d = new Date(startDate);
    if (isNaN(d.getTime())) return startDate;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[d.getDay()];
    const month = months[d.getMonth()];
    const date = d.getDate();

    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    let result = `${dayName}, ${month} ${date} — ${hours}`;
    const mins = d.getMinutes().toString().padStart(2, '0');
    result += `:${mins} ${ampm}`;

    if (endTime) {
      const e = new Date(endTime);
      if (!isNaN(e.getTime())) {
        let eHours = e.getHours();
        const eAmpm = eHours >= 12 ? 'PM' : 'AM';
        eHours = eHours % 12 || 12;
        const eMins = e.getMinutes().toString().padStart(2, '0');
        result += ` to ${eHours}:${eMins} ${eAmpm}`;
      }
    }

    return result;
  } catch {
    return startDate;
  }
}

// ─── 5. Read variety plan ────────────────────────────────────────────
function readVarietyPlan(path) {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

// ─── 6. Build issue date ─────────────────────────────────────────────
function getIssueDate() {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const m1 = months[monday.getMonth()];
  const d1 = monday.getDate();
  const y1 = monday.getFullYear();
  const m2 = months[sunday.getMonth()];
  const d2 = sunday.getDate();
  const y2 = sunday.getFullYear();

  const getOrdinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  return `${m1} ${d1}${getOrdinal(d1)} – ${m2} ${d2}${getOrdinal(d2)}, ${y2}`;
}

// ─── 7. Build submissions context for LLM ────────────────────────────
function buildSubmissionsContext(submissions, fngStats) {
  const sectionOrder = ['fng-tracker', 'desk', 'whats-hot', 'individual-init', 'still-fresh', 'helpful-links'];
  const sectionLabels = {
    'fng-tracker': '2026 FNG Tracker',
    'desk': "Desk of the Nan'tan",
    'whats-hot': "What's Hot in The Fort",
    'individual-init': 'Individual Initiative',
    'still-fresh': 'Still Fresh',
    'helpful-links': 'Helpful Links',
  };

  const grouped = {};
  for (const secId of sectionOrder) {
    grouped[secId] = [];
  }
  for (const sub of submissions) {
    const sec = sub.section;
    if (sec && grouped[sec]) {
      grouped[sec].push(sub);
    }
  }

  let context = `This week's issue date: ${getIssueDate()}\n\n`;
  context += `FNG Progress: ${fngStats.total2026}/${fngStats.goal} (${fngStats.progressPercent}%), ${fngStats.onTrack ? 'On track' : 'Behind pace'}, Day ${fngStats.daysElapsed} of 365\n\n`;

  for (const secId of sectionOrder) {
    const entries = grouped[secId];
    if (!entries || entries.length === 0) continue;

    context += `=== ${sectionLabels[secId]} (${secId}) ===\n`;
    for (const entry of entries) {
      context += `\n[Event ID: ${entry.id}]\n`;
      context += `Title: ${entry.title}\n`;
      if (entry.leader) context += `Leader: ${entry.leader}\n`;
      if (entry.start_date) context += `Date: ${formatDate(entry.start_date, entry.end_time)}\n`;
      if (entry.location) context += `Location: ${entry.location}\n`;
      context += `Description: ${entry.description}\n`;
      if (entry.link) context += `Link: ${entry.link}\n`;
    }
    context += '\n';
  }

  return context;
}

// ─── 8. Call LLM for variety plan ────────────────────────────────────
async function callLLMForVarietyPlan(submissionsContext) {
  // Dynamically import to avoid issues when not using LLM
  const { generateObject } = await import('ai');
  const { z } = await import('zod');
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');

  const provider = createOpenAICompatible({
    name: 'f3-openai',
    baseURL: LLM_BASE_URL,
    apiKey: 'local',
  });

  const model = provider.languageModel(LLM_MODEL);

  const VarietyPlanSchema = z.object({
    issue_date: z.string().describe('Date range for this issue, e.g. "May 17 – 23, 2026"'),
    featured_event_id: z.number().int().describe('The ID of the featured event (exactly one)'),
    featured_reason: z.string().describe('Brief reason why this event is featured'),
    sections: z.array(z.object({
      id: z.string(),
      label: z.string(),
      intro: z.string().describe('1-2 sentence personality-driven intro for this section'),
    })),
    events: z.array(z.object({
      id: z.number().int(),
      format: z.enum(['hero', 'standard', 'quote', 'minimal', 'story']),
      description: z.string().describe('Enhanced description with F3 voice. Keep all facts, fix mistakes, add brief context.'),
      title_override: z.string().nullable().describe('Optional title override, or null'),
    })),
    bridges: z.array(z.string()).describe('1-2 narrative bridge sentences between sections'),
  });

  const systemPrompt = `You are the newsletter writer for F3 The Fort, a fitness fellowship community in Fort Mill, SC.
You understand F3 culture deeply: brotherhood, SYITG (Shut Up, Ignite, Go), Gloom (the discomfort zone),
AAR (After Action Review), FNG (First New Guy), Nan'tan (the leader), Invergence, WOFO, PRT, etc.

Your voice is motivational, brotherly, occasionally humorous, and always authentic.
Not corporate. Not salesy. Written by a brother, for brothers.

Sections and their meanings:
- fng-tracker: New FNG progress toward 226 goal and new FNGs this week
- desk: Nan'tan's message/announcement (Band Camp is the Nan'tan)
- whats-hot: Featured events worth highlighting — the big ones
- individual-init: Individual workouts/initiatives brothers are doing on their own
- still-fresh: Recurring or ongoing events (weekly happy hours, monthly volunteer work, etc.)
- helpful-links: Useful resources and links for brothers

Your task:
1. Pick EXACTLY ONE event as the "featured" event — the most significant, timely, or unique one for this week.
2. Assign each event a format: hero, standard, quote, minimal, or story.
   - hero: For the featured event only — large, prominent
   - standard: Regular events (default for most)
   - quote: For AARs, memorable descriptions, or quotes from brothers
   - minimal: For quick-list items like volunteer drives, recurring events with simple descriptions
   - story: For community events, multi-part events, or events with rich narratives
3. Rewrite each description with F3 voice — keep ALL original facts (dates, locations, links),
   fix grammar/spelling mistakes, add brief context where helpful, make it engaging.
   Do NOT invent facts. Preserve the submitter's intent.
4. Write a 1-2 sentence personality-driven intro for each section that has events.
5. Write 1-2 narrative bridge sentences to transition between sections.

Be specific about F3 culture. Use F3 terminology naturally. Make brothers want to show up.`;

  const { object } = await generateObject({
    model,
    schema: VarietyPlanSchema,
    system: systemPrompt,
    prompt: `Here are this week's submissions:\n\n${submissionsContext}\n\nGenerate a variety plan following the output schema. Return valid JSON only.`,
    temperature: LLM_TEMPERATURE,
    maxTokens: 4096,
  });

  return object;
}

// ─── 9. Escape HTML ──────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 10. Build web preview HTML ──────────────────────────────────────
function buildWebHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs) {
  const sections = staticData.sections;
  const sectionOrder = sections.map(s => s.id);
  const sectionLabels = Object.fromEntries(sections.map(s => [s.id, s.label]));

  // Map variety plan events by ID
  const planEvents = {};
  if (varietyPlan && varietyPlan.events) {
    for (const ev of varietyPlan.events) {
      planEvents[ev.id] = ev;
    }
  }

  // Map variety plan section intros
  const planSectionIntros = {};
  if (varietyPlan && varietyPlan.sections) {
    for (const sec of varietyPlan.sections) {
      planSectionIntros[sec.id] = sec.intro;
    }
  }

  // Map bridges
  const planBridges = varietyPlan && varietyPlan.bridges ? varietyPlan.bridges : [];

  // Group submissions by section
  const grouped = {};
  for (const secId of sectionOrder) {
    grouped[secId] = [];
  }
  for (const sub of submissions) {
    const sec = sub.section;
    if (sec && grouped[sec]) {
      grouped[sec].push(sub);
    }
  }

  const totalEntries = submissions.length;
  const issueDate = varietyPlan?.issue_date || getIssueDate();

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Fort — Weekly Notification</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --color-bg: #0D0D0D;
    --color-bg-alt: #141414;
    --color-surface: #1A1A1A;
    --color-card: #1E1E1E;
    --color-card-hover: #242424;
    --color-text: #E8E4DF;
    --color-text-muted: #9A9189;
    --color-text-faint: #6B635B;
    --color-accent: #C43A3A;
    --color-accent-light: #E05050;
    --color-accent-pale: rgba(196, 58, 58, 0.12);
    --color-accent-glow: rgba(196, 58, 58, 0.25);
    --color-border: #2A2A2A;
    --color-border-light: #222222;
    --color-success: #4A9D6C;
    --color-success-bg: rgba(74, 157, 108, 0.1);
    --font-display: 'Playfair Display', 'Georgia', serif;
    --font-body: 'Source Serif 4', 'Georgia', serif;
    --font-ui: 'DM Sans', 'Helvetica Neue', sans-serif;
    --space-xs: 0.25rem;
    --space-sm: 0.5rem;
    --space-md: 1rem;
    --space-lg: 1.5rem;
    --space-xl: 2.5rem;
    --space-2xl: 4rem;
    --radius-md: 8px;
    --radius-lg: 12px;
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 8px 30px rgba(0, 0, 0, 0.5);
    --shadow-accent: 0 0 20px rgba(196, 58, 58, 0.15);
    --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  }

  html { font-size: 16px; scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }

  body {
    font-family: var(--font-body);
    font-size: 1rem;
    line-height: 1.7;
    color: var(--color-text);
    background-color: var(--color-bg);
    min-height: 100vh;
  }

  body::before {
    content: '';
    position: fixed; inset: 0;
    background:
      radial-gradient(ellipse at 30% 0%, rgba(196, 58, 58, 0.06) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 100%, rgba(196, 58, 58, 0.04) 0%, transparent 50%);
    pointer-events: none; z-index: 0;
  }

  .container {
    position: relative; z-index: 1;
    max-width: 780px;
    margin: 0 auto;
    padding: var(--space-xl) var(--space-lg);
  }

  .masthead {
    text-align: center;
    padding: var(--space-2xl) 0 var(--space-xl);
    position: relative;
  }

  .masthead::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%; transform: translateX(-50%);
    width: 120px; height: 2px;
    background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
  }

  .masthead__eyebrow {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--color-accent);
    margin-bottom: var(--space-sm);
    display: block;
  }

  .masthead__title {
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 6vw, 3.8rem);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: var(--space-xs);
    color: var(--color-text);
  }

  .masthead__title em {
    font-style: italic;
    font-weight: 600;
    color: var(--color-accent);
    text-shadow: 0 0 40px var(--color-accent-glow);
  }

  .masthead__subtitle {
    font-family: var(--font-body);
    font-size: 1.1rem;
    font-style: italic;
    color: var(--color-text-muted);
    margin-top: var(--space-sm);
  }

  .issue-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-md);
    margin-top: var(--space-lg);
    padding-top: var(--space-lg);
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--color-text-faint);
    letter-spacing: 0.04em;
  }

  .issue-bar__sep {
    width: 4px; height: 4px;
    background: var(--color-text-faint);
    border-radius: 50%;
    display: inline-block;
    opacity: 0.5;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    margin-bottom: var(--space-lg);
    margin-top: var(--space-xl);
  }

  .section-header__label {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--color-accent);
    white-space: nowrap;
    text-shadow: 0 0 12px var(--color-accent-glow);
  }

  .section-header__rule {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, var(--color-accent), transparent);
    opacity: 0.4;
  }

  .section-intro {
    font-family: var(--font-body);
    font-size: 0.95rem;
    font-style: italic;
    color: var(--color-text-muted);
    margin-bottom: var(--space-lg);
    padding-left: var(--space-md);
    border-left: 2px solid var(--color-accent);
    opacity: 0.8;
  }

  .narrative-bridge {
    font-family: var(--font-body);
    font-size: 1rem;
    font-style: italic;
    color: var(--color-text-muted);
    text-align: center;
    padding: var(--space-lg) 0;
    opacity: 0.7;
    border-top: 1px solid var(--color-border-light);
    border-bottom: 1px solid var(--color-border-light);
    margin: var(--space-xl) 0;
  }

  .event-card {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-xl);
    box-shadow: var(--shadow-sm);
    margin-bottom: var(--space-lg);
    transition: box-shadow 0.3s var(--ease-out), transform 0.3s var(--ease-out), border-color 0.3s var(--ease-out);
    position: relative;
    overflow: hidden;
    animation: slideUp 0.5s var(--ease-out) forwards;
    opacity: 0;
  }

  .event-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
    border-color: var(--color-accent);
  }

  .event-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 3px; height: 100%;
    background: var(--color-accent);
    opacity: 0;
    transition: opacity 0.3s var(--ease-out);
  }

  .event-card:hover::before { opacity: 1; }

  .event-card:nth-child(1) { animation-delay: 0.05s; }
  .event-card:nth-child(2) { animation-delay: 0.1s; }
  .event-card:nth-child(3) { animation-delay: 0.15s; }
  .event-card:nth-child(4) { animation-delay: 0.2s; }
  .event-card:nth-child(5) { animation-delay: 0.25s; }
  .event-card:nth-child(6) { animation-delay: 0.3s; }
  .event-card:nth-child(7) { animation-delay: 0.35s; }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .event-card__top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-md);
    margin-bottom: var(--space-sm);
  }

  .event-card__title {
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
    color: var(--color-text);
  }

  .event-card__title a {
    color: inherit;
    text-decoration: none;
  }

  .event-card__title a:hover {
    color: var(--color-accent-light);
    text-decoration: underline;
  }

  .event-card__leader {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-accent);
    background: var(--color-accent-pale);
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-md);
    white-space: nowrap;
    flex-shrink: 0;
    border: 1px solid rgba(196, 58, 58, 0.15);
  }

  .event-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm) var(--space-lg);
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--color-text-muted);
    margin-bottom: var(--space-md);
  }

  .event-card__meta-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .event-card__meta-item .icon {
    font-size: 0.9rem;
    line-height: 1;
  }

  .event-card__description {
    font-size: 0.95rem;
    line-height: 1.75;
    color: var(--color-text);
  }

  .event-card__description img {
    max-width: 100%;
    border-radius: var(--radius-md);
    margin: var(--space-md) 0;
    border: 1px solid var(--color-border);
  }

  .event-card__description a {
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-color: rgba(196, 58, 58, 0.3);
    text-underline-offset: 2px;
  }

  .event-card__description a:hover {
    color: var(--color-accent-light);
  }

  .event-card__description br { display: none; }

  .event-card__description strong {
    color: var(--color-accent-light);
    font-weight: 600;
  }

  .event-card__description ol, .event-card__description ul {
    margin: var(--space-sm) 0;
    padding-left: 1.5rem;
  }

  .event-card__description li {
    margin-bottom: var(--space-xs);
  }

  .event-card__description li::marker {
    color: var(--color-accent);
  }

  .event-card__link {
    margin-top: var(--space-md);
    padding-top: var(--space-sm);
  }

  .event-card__link a {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-accent);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    text-decoration: none;
  }

  .event-card__link a:hover {
    color: var(--color-accent-light);
  }

  .event-card__link a::after {
    content: '→';
    transition: transform 0.2s var(--ease-out);
  }

  .event-card__link a:hover::after {
    transform: translateX(3px);
  }

  /* Hero card */
  .event-card--hero {
    background: linear-gradient(135deg, var(--color-card) 0%, rgba(196, 58, 58, 0.08) 100%);
    border: 1px solid var(--color-accent);
    padding: var(--space-2xl);
    box-shadow: var(--shadow-accent);
  }

  .event-card--hero .event-card__title {
    font-size: 1.8rem;
  }

  .event-card--hero .event-card__description {
    font-size: 1.05rem;
  }

  .event-card--hero .featured-badge {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: #fff;
    background: var(--color-accent);
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    display: inline-block;
    margin-bottom: var(--space-sm);
  }

  /* Quote card */
  .event-card--quote {
    background: var(--color-bg-alt);
    border: none;
    border-left: 4px solid var(--color-accent);
    padding: var(--space-2xl) var(--space-xl);
  }

  .event-card--quote .event-card__title {
    font-size: 1.3rem;
    font-style: italic;
  }

  .event-card--quote .event-card__description {
    font-size: 1.1rem;
    font-style: italic;
    color: var(--color-text-muted);
    line-height: 1.8;
  }

  /* Minimal card */
  .event-card--minimal {
    background: transparent;
    border: none;
    padding: var(--space-sm) 0;
    box-shadow: none;
  }

  .event-card--minimal:hover {
    transform: none;
    box-shadow: none;
    border-color: transparent;
  }

  .event-card--minimal::before { display: none; }

  .event-card--minimal .event-card__title {
    font-size: 1.05rem;
    font-weight: 500;
  }

  .event-card--minimal .event-card__meta {
    font-size: 0.78rem;
  }

  /* Story card */
  .event-card--story {
    background: var(--color-surface);
    border-left: 4px solid var(--color-accent);
  }

  .event-card--story .event-card__title {
    font-size: 1.35rem;
  }

  .event-card--story .event-card__description {
    font-size: 0.98rem;
  }

  .newsletter-footer {
    text-align: center;
    padding: var(--space-2xl) 0 var(--space-xl);
    margin-top: var(--space-2xl);
    border-top: 1px solid var(--color-border);
  }

  .newsletter-footer__text {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--color-text-faint);
    line-height: 1.8;
  }

  .newsletter-footer__text a {
    color: var(--color-text-muted);
    text-decoration: underline;
    text-decoration-color: rgba(196, 58, 58, 0.2);
  }

  .newsletter-footer__motto {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-style: italic;
    color: var(--color-text-muted);
    margin-top: var(--space-md);
  }

  @media (max-width: 768px) {
    .container { padding: var(--space-lg) var(--space-md); }
    .event-card { padding: var(--space-lg); }
    .event-card__top { flex-direction: column; }
    .event-card__meta { flex-direction: column; gap: var(--space-xs); }
    .event-card__meta-item::before { display: none; }
  }

  @media print {
    body::before { display: none; }
    .event-card { box-shadow: none; border: 1px solid #333; break-inside: avoid; }
    .event-card:hover { transform: none; }
  }
</style>
</head>
<body>

<div class="container">

  <!-- Masthead -->
  <header class="masthead">
    <span class="masthead__eyebrow">${escapeHtml(staticData.masthead.eyebrow)}</span>
    <h1 class="masthead__title">${escapeHtml(staticData.masthead.title)}</h1>
    <p class="masthead__subtitle">${escapeHtml(staticData.masthead.subtitle)}</p>
    <div class="issue-bar">
      <span>${escapeHtml(issueDate)}</span>
      <span class="issue-bar__sep"></span>
      <span>${totalEntries} Entries</span>
      <span class="issue-bar__sep"></span>
      <span>${escapeHtml(staticData.issue.organization)}</span>
    </div>
  </header>`;

  // Track which sections have events for bridges
  let lastSectionWithEvents = null;
  let bridgeIndex = 0;

  for (const secId of sectionOrder) {
    const entries = grouped[secId];
    if (!entries || entries.length === 0) continue;

    const label = sectionLabels[secId];
    const intro = planSectionIntros[secId] || '';

    // Add narrative bridge between sections
    if (lastSectionWithEvents && planBridges && bridgeIndex < planBridges.length) {
      html += `
  <div class="narrative-bridge">${escapeHtml(planBridges[bridgeIndex])}</div>`;
      bridgeIndex++;
    }

    html += `
  <!-- ${label} -->
  <div class="section-header">
    <span class="section-header__label">${escapeHtml(label)}</span>
    <span class="section-header__rule"></span>
  </div>`;

    if (intro) {
      html += `
  <p class="section-intro">${escapeHtml(intro)}</p>`;
    }

    for (const sub of entries) {
      const planEvent = planEvents[sub.id] || {};
      const format = planEvent.format || 'standard';
      const titleOverride = planEvent.title_override;
      const enhancedDesc = planEvent.description || sub.description;

      const cardClass = `event-card event-card--${format}`;

      html += `
    <article class="${cardClass}">`;

      if (format === 'hero') {
        html += `
      <span class="featured-badge">Featured</span>`;
      }

      html += `
      <div class="event-card__top">
        <h2 class="event-card__title">${escapeHtml(titleOverride || sub.title)}</h2>`;

      if (sub.leader) {
        html += `
        <span class="event-card__leader">${escapeHtml(sub.leader)}</span>`;
      }

      html += `
      </div>
      <div class="event-card__meta">`;

      if (sub.start_date) {
        const dateStr = formatDate(sub.start_date, sub.end_time);
        html += `
        <span class="event-card__meta-item">
          <span class="icon">📅</span> ${escapeHtml(dateStr)}
        </span>`;
      }

      if (sub.location) {
        html += `
        <span class="event-card__meta-item">
          <span class="icon">📍</span> ${escapeHtml(sub.location)}
        </span>`;
      }

      html += `
      </div>`;

      if (enhancedDesc) {
        html += `
      <div class="event-card__description">
        ${enhancedDesc}
      </div>`;
      }

      if (sub.link) {
        html += `
      <div class="event-card__link">
        <a href="${escapeHtml(sub.link)}" target="_blank" rel="noopener">Details</a>
      </div>`;
      }

      html += `
    </article>`;
    }

    // FNG Progress Tracker — right after Desk of the Nan'tan
    if (secId === 'desk') {
      const { goal, total2026, daysElapsed, expectedFngs, progressPercent, onTrack } = fngStats;
      const barWidth = Math.min(100, progressPercent);
      const barColor = onTrack ? 'var(--color-success)' : 'var(--color-accent)';

      html += `
    <!-- FNG Progress Tracker -->
    <div class="section-header">
      <span class="section-header__label">2026 FNG Progress</span>
      <span class="section-header__rule"></span>
    </div>
    <div style="background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-xl); margin-bottom: var(--space-xl);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md);">
        <span style="font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; color: var(--color-text);">Goal: ${goal} FNGs</span>
        <span style="font-family: var(--font-ui); font-size: 1.1rem; font-weight: 600; color: ${barColor};">${total2026} / ${goal} (${progressPercent}%)</span>
      </div>
      <div style="background: var(--color-bg-alt); border-radius: var(--radius-md); height: 24px; overflow: hidden; margin-bottom: var(--space-md);">
        <div style="background: ${barColor}; height: 100%; width: ${barWidth}%; border-radius: var(--radius-md); transition: width 0.5s ease;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-family: var(--font-ui); font-size: 0.82rem; color: var(--color-text-muted);">
        <span>Day ${daysElapsed} of 365</span>
        <span>Target: ${expectedFngs} FNGs by now</span>
        <span>${onTrack ? '✅ On track' : '⚠️ Behind pace'}</span>
      </div>
    </div>`;

      if (weeklyFngs && weeklyFngs.length > 0) {
        html += `
    <!-- New FNGs This Week -->
    <div class="section-header">
      <span class="section-header__label">New FNGs This Week</span>
      <span class="section-header__rule"></span>
    </div>
    <div style="background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-xl); margin-bottom: var(--space-xl);">
      <div style="display: flex; flex-direction: column; gap: var(--space-md);">`;

        for (const fng of weeklyFngs) {
          const displayName = fng.f3_name || `${fng.first_name} ${fng.last_name}`;
          html += `
        <div style="display: flex; align-items: flex-start; gap: var(--space-md); padding: var(--space-sm) 0; border-bottom: 1px solid var(--color-border-light);">
          <span style="font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; color: var(--color-text);">${escapeHtml(displayName)}</span>`;
          if (fng.ehed_by) {
            html += `
          <span style="font-family: var(--font-ui); font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.2rem;">EH'ed by ${escapeHtml(fng.ehed_by)}</span>`;
          }
          html += `
        </div>`;
        }

        html += `
      </div>
    </div>`;
      }
    }

    lastSectionWithEvents = secId;
  }

  // Footer
  html += `
  <!-- Footer -->
  <footer class="newsletter-footer">
    <div style="display: flex; gap: var(--space-md); justify-content: center; flex-wrap: wrap; margin-bottom: var(--space-lg);">
      <a href="mailto:thefort@f3nation.com" style="color: var(--color-text); text-decoration: none; display: flex; align-items: center; gap: var(--space-xs);">
        <span style="font-size: 1.2rem;">&#9993;</span> thefort@f3nation.com
      </a>
      <a href="https://f3thefort.com/" target="_blank" rel="noopener" style="color: var(--color-text); text-decoration: none; display: flex; align-items: center; gap: var(--space-xs);">
        <span style="font-size: 1.2rem;">&#127760;</span> f3thefort.com
      </a>
      <a href="https://www.instagram.com/f3_the_fort/" target="_blank" rel="noopener" style="color: var(--color-text); text-decoration: none; display: flex; align-items: center; gap: var(--space-xs);">
        <span style="font-size: 1.2rem;">&#128247;</span> @f3_the_fort
      </a>
    </div>
    <div style="background: var(--color-surface); padding: var(--space-lg); border-radius: var(--radius-md); margin-bottom: var(--space-lg);">
      <h4 style="font-family: var(--font-display); margin-bottom: var(--space-md); color: var(--color-text);">Shared Leadership Team (SLT)</h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-sm) var(--space-lg); font-size: 0.95rem; line-height: 1.6;">
        <div><strong>Nan'tan:</strong> Band Camp</div>
        <div><strong>1st F (East):</strong> Time Machine</div>
        <div><strong>1st F (West):</strong> Bonsai</div>
        <div><strong>2nd F:</strong> Liberty Bibberty</div>
        <div><strong>3rd F:</strong> Cornerstone</div>
        <div><strong>Weasel Shaker:</strong> Poppins</div>
        <div><strong>LDP:</strong> Cyclops</div>
        <div><strong>Comz:</strong> 38 Special, Console</div>
        <div><strong>Newsletter:</strong> Bitcoin, Console, Ruby Slippers</div>
      </div>
    </div>
    <p class="newsletter-footer__text">
      Submit your events at <a href="${escapeHtml(staticData.footer.submitUrl)}" target="_blank" rel="noopener">submit.f3thefort.com</a>
    </p>
    <p class="newsletter-footer__motto">${escapeHtml(staticData.footer.motto)}</p>
    <p style="text-align: center; font-size: 0.8rem; color: var(--color-text-faint); line-height: 1.6; margin-top: var(--space-lg);">
      Copyright (C) 2026 The Fort F3. All rights reserved.<br>
      Our mailing address is: The Fort F3
    </p>
  </footer>

</div>

</body>
</html>`;

  return html;
}

// ─── 11. Build email HTML (table-based, inline styles) ───────────────
function buildEmailHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs) {
  const sections = staticData.sections;
  const sectionOrder = sections.map(s => s.id);
  const sectionLabels = Object.fromEntries(sections.map(s => [s.id, s.label]));

  // Map variety plan events by ID
  const planEvents = {};
  if (varietyPlan && varietyPlan.events) {
    for (const ev of varietyPlan.events) {
      planEvents[ev.id] = ev;
    }
  }

  // Map variety plan section intros
  const planSectionIntros = {};
  if (varietyPlan && varietyPlan.sections) {
    for (const sec of varietyPlan.sections) {
      planSectionIntros[sec.id] = sec.intro;
    }
  }

  // Group submissions by section
  const grouped = {};
  for (const secId of sectionOrder) {
    grouped[secId] = [];
  }
  for (const sub of submissions) {
    const sec = sub.section;
    if (sec && grouped[sec]) {
      grouped[sec].push(sub);
    }
  }

  const totalEntries = submissions.length;
  const issueDate = varietyPlan?.issue_date || getIssueDate();

  // Build issue bar
  const issueBar = `${escapeHtml(issueDate)} &nbsp;&nbsp;&bull;&nbsp;&nbsp; ${totalEntries} Entries &nbsp;&nbsp;&bull;&nbsp;&nbsp; ${escapeHtml(staticData.issue.organization)}`;

  // Build sections content
  let sectionsContent = '';
  let lastSectionWithEvents = null;

  for (const secId of sectionOrder) {
    const entries = grouped[secId];
    if (!entries || entries.length === 0) continue;

    const label = sectionLabels[secId];
    const intro = planSectionIntros[secId] || '';

    // Section header
    sectionsContent += `
        <tr>
          <td style="padding: 32px 0 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; color: #C43A3A; text-shadow: 0 0 12px rgba(196, 58, 58, 0.3);">
                  ${escapeHtml(label)}
                </td>
                <td style="height: 1px; background: linear-gradient(90deg, #C43A3A, transparent); opacity: 0.4;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>`;

    // Section intro
    if (intro) {
      sectionsContent += `
        <tr>
          <td style="padding: 0 0 16px 8px;">
            <p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 14px; font-style: italic; color: #9A9189; line-height: 1.6; border-left: 2px solid #C43A3A; padding-left: 8px; opacity: 0.8;">${escapeHtml(intro)}</p>
          </td>
        </tr>`;
    }

    // Events
    for (const sub of entries) {
      const planEvent = planEvents[sub.id] || {};
      const format = planEvent.format || 'standard';
      const titleOverride = planEvent.title_override;
      const enhancedDesc = planEvent.description || sub.description;
      const title = escapeHtml(titleOverride || sub.title);

      if (format === 'hero') {
        sectionsContent += buildEmailHeroCard(sub, title, enhancedDesc, planEvent);
      } else if (format === 'quote') {
        sectionsContent += buildEmailQuoteCard(sub, title, enhancedDesc);
      } else if (format === 'minimal') {
        sectionsContent += buildEmailMinimalCard(sub, title, enhancedDesc);
      } else if (format === 'story') {
        sectionsContent += buildEmailStoryCard(sub, title, enhancedDesc);
      } else {
        sectionsContent += buildEmailStandardCard(sub, title, enhancedDesc);
      }
    }

    // FNG Progress Tracker
    if (secId === 'desk') {
      const { goal, total2026, daysElapsed, expectedFngs, progressPercent, onTrack } = fngStats;
      const barWidth = Math.min(100, progressPercent);
      const barColor = onTrack ? '#4A9D6C' : '#C43A3A';

      sectionsContent += `
        <tr>
          <td style="padding: 24px 0 8px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; color: #C43A3A;">
                  2026 FNG Progress
                </td>
                <td style="height: 1px; background: linear-gradient(90deg, #C43A3A, transparent); opacity: 0.4;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 0 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1E1E1E; border: 1px solid #2A2A2A; border-radius: 12px;">
              <tr>
                <td style="padding: 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                    <tr>
                      <td style="font-family: 'Playfair Display', Georgia, serif; font-size: 20px; font-weight: 700; color: #E8E4DF;">Goal: ${goal} FNGs</td>
                      <td align="right" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 16px; font-weight: 600; color: ${barColor};">${total2026} / ${goal} (${progressPercent}%)</td>
                    </tr>
                  </table>
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #141414; border-radius: 8px; height: 24px; overflow: hidden; margin-bottom: 16px;">
                    <tr>
                      <td style="background-color: ${barColor}; height: 100%; width: ${barWidth}%;">&nbsp;</td>
                    </tr>
                  </table>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189;">Day ${daysElapsed} of 365</td>
                      <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189;">Target: ${expectedFngs} FNGs by now</td>
                      <td align="right" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189;">${onTrack ? '&#x2705; On track' : '&#x26a0;&#xfe0f; Behind pace'}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

      if (weeklyFngs && weeklyFngs.length > 0) {
        sectionsContent += `
        <tr>
          <td style="padding: 24px 0 8px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; color: #C43A3A;">
                  New FNGs This Week
                </td>
                <td style="height: 1px; background: linear-gradient(90deg, #C43A3A, transparent); opacity: 0.4;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 0 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1E1E1E; border: 1px solid #2A2A2A; border-radius: 12px;">
              <tr>
                <td style="padding: 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">`;

        for (const fng of weeklyFngs) {
          const displayName = escapeHtml(fng.f3_name || `${fng.first_name} ${fng.last_name}`);
          sectionsContent += `
                    <tr>
                      <td style="font-family: 'Playfair Display', Georgia, serif; font-size: 18px; font-weight: 600; color: #E8E4DF; padding: 8px 0; border-bottom: 1px solid #222;">${displayName}</td>`;
          if (fng.ehed_by) {
            sectionsContent += `
                      <td align="right" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189; padding: 8px 0; border-bottom: 1px solid #222;">EH'ed by ${escapeHtml(fng.ehed_by)}</td>`;
          }
          sectionsContent += `
                    </tr>`;
        }

        sectionsContent += `
                </table>
              </td>
            </tr>
            </table>
          </td>
        </tr>`;
      }
    }

    lastSectionWithEvents = secId;
  }

  // Build footer
  const footer = `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
              <tr>
                <td align="center">
                  <table cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr>
                      <td style="padding: 0 12px;">
                        <a href="mailto:thefort@f3nation.com" style="color: #E8E4DF; text-decoration: none; font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 14px;">&#9993; thefort@f3nation.com</a>
                      </td>
                      <td style="padding: 0 12px;">
                        <a href="https://f3thefort.com/" target="_blank" style="color: #E8E4DF; text-decoration: none; font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 14px;">&#127760; f3thefort.com</a>
                      </td>
                      <td style="padding: 0 12px;">
                        <a href="https://www.instagram.com/f3_the_fort/" target="_blank" style="color: #E8E4DF; text-decoration: none; font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 14px;">&#128247; @f3_the_fort</a>
                      </td>
                    </tr>
                  </table>
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1A1A1A; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
                    <tr>
                      <td>
                        <h4 style="font-family: 'Playfair Display', Georgia, serif; font-size: 18px; color: #E8E4DF; margin: 0 0 16px 0;">Shared Leadership Team (SLT)</h4>
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>Nan'tan:</strong> Band Camp</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>1st F (East):</strong> Time Machine</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>1st F (West):</strong> Bonsai</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>2nd F:</strong> Liberty Bibberty</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>3rd F:</strong> Cornerstone</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>Weasel Shaker:</strong> Poppins</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>LDP:</strong> Cyclops</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>Comz:</strong> 38 Special, Console</td></tr>
                          <tr><td style="font-size: 14px; color: #E8E4DF; padding: 4px 0;"><strong>Newsletter:</strong> Bitcoin, Console, Ruby Slippers</td></tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <p style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #6B635B; line-height: 1.8; margin-bottom: 16px;">
                    Submit your events at <a href="${escapeHtml(staticData.footer.submitUrl)}" target="_blank" style="color: #9A9189; text-decoration: underline;">submit.f3thefort.com</a>
                  </p>
                  <p style="font-family: 'Playfair Display', Georgia, serif; font-size: 18px; font-style: italic; color: #9A9189; margin-bottom: 16px;">${escapeHtml(staticData.footer.motto)}</p>
                  <p style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; color: #6B635B; line-height: 1.6;">
                    Copyright (C) 2026 The Fort F3. All rights reserved.<br>
                    Our mailing address is: The Fort F3
                  </p>
                </td>
              </tr>
            </table>`;

  // Now assemble the full email HTML
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Fort — Weekly Notification</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0D0D0D; font-family: 'Source Serif 4', Georgia, serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">

<!-- Wrapper table -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0D0D0D;">
  <tr>
    <td align="center" style="padding: 24px 8px;">

      <!-- Main content table (600px max) -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">

        <!-- Masthead -->
        <tr>
          <td align="center" style="padding: 40px 0 32px; position: relative;">
            <span style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.22em; color: #C43A3A; display: block;">${escapeHtml(staticData.masthead.eyebrow)}</span>
            <h1 style="font-family: 'Playfair Display', Georgia, serif; font-size: 42px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; margin: 4px 0; color: #E8E4DF;">${escapeHtml(staticData.masthead.title)}</h1>
            <p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 18px; font-style: italic; color: #9A9189; margin-top: 4px;">${escapeHtml(staticData.masthead.subtitle)}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 16px;">
              <tr>
                <td align="center" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #6B635B; letter-spacing: 0.04em;">
                  ${issueBar}
                </td>
              </tr>
            </table>
            <table width="120" cellpadding="0" cellspacing="0" style="margin: 24px auto 0;">
              <tr>
                <td style="height: 1px; background: linear-gradient(90deg, transparent, #C43A3A, transparent);"></td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sections and Events -->
        ${sectionsContent}

        <!-- Footer -->
        <tr>
          <td style="padding: 48px 0 32px; border-top: 1px solid #2A2A2A;">
            ${footer}
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

  return html;
}

// ─── 12. Email card builders ─────────────────────────────────────────
function buildEmailStandardCard(sub, title, enhancedDesc) {
  let card = `
        <tr>
          <td style="padding: 12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1E1E1E; border: 1px solid #2A2A2A; border-radius: 12px;">
              <tr>
                <td style="padding: 24px;">`;

  // Title + leader
  card += `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
                  <tr>
                    <td style="font-family: 'Playfair Display', Georgia, serif; font-size: 22px; font-weight: 700; line-height: 1.25; color: #E8E4DF;">${title}</td>`;

  if (sub.leader) {
    card += `
                    <td align="right" style="white-space: nowrap;">
                      <span style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: #C43A3A; background-color: rgba(196, 58, 58, 0.12); padding: 5px 11px; border-radius: 8px; border: 1px solid rgba(196, 58, 58, 0.15);">${escapeHtml(sub.leader)}</span>
                    </td>`;
  }

  card += `
                  </tr>
                </table>`;

  // Meta (date + location)
  if (sub.start_date || sub.location) {
    card += `
                <table cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">`;

    if (sub.start_date) {
      const dateStr = formatDate(sub.start_date, sub.end_time);
      card += `
                  <tr>
                    <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189; padding-right: 24px;">&#128197; ${escapeHtml(dateStr)}</td>`;
    }

    if (sub.location) {
      card += `
                    <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189;">&#128205; ${escapeHtml(sub.location)}</td>`;
    }

    card += `
                  </tr>
                </table>`;
  }

  // Description
  if (enhancedDesc) {
    card += `
                <div style="font-size: 14px; line-height: 1.75; color: #E8E4DF;">
                  ${enhancedDesc}
                </div>`;
  }

  // Link
  if (sub.link) {
    card += `
                <div style="margin-top: 16px; padding-top: 8px;">
                  <a href="${escapeHtml(sub.link)}" target="_blank" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #C43A3A; text-decoration: none;">Details &#8594;</a>
                </div>`;
  }

  card += `
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  return card;
}

function buildEmailHeroCard(sub, title, enhancedDesc, planEvent) {
  let card = `
        <tr>
          <td style="padding: 12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1E1E1E 0%, rgba(196, 58, 58, 0.08) 100%); border: 1px solid #C43A3A; border-radius: 12px;">
              <tr>
                <td style="padding: 32px;">`;

  // Featured badge
  card += `
                <span style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #FFFFFF; background-color: #C43A3A; padding: 4px 9px; border-radius: 4px; display: inline-block; margin-bottom: 8px;">Featured</span>`;

  // Title + leader
  card += `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
                  <tr>
                    <td style="font-family: 'Playfair Display', Georgia, serif; font-size: 28px; font-weight: 700; line-height: 1.25; color: #E8E4DF;">${title}</td>`;

  if (sub.leader) {
    card += `
                    <td align="right" style="white-space: nowrap;">
                      <span style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: #C43A3A; background-color: rgba(196, 58, 58, 0.12); padding: 5px 11px; border-radius: 8px; border: 1px solid rgba(196, 58, 58, 0.15);">${escapeHtml(sub.leader)}</span>
                    </td>`;
  }

  card += `
                  </tr>
                </table>`;

  // Meta
  if (sub.start_date || sub.location) {
    card += `
                <table cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">`;

    if (sub.start_date) {
      const dateStr = formatDate(sub.start_date, sub.end_time);
      card += `
                  <tr>
                    <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189; padding-right: 24px;">&#128197; ${escapeHtml(dateStr)}</td>`;
    }

    if (sub.location) {
      card += `
                    <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189;">&#128205; ${escapeHtml(sub.location)}</td>`;
    }

    card += `
                  </tr>
                </table>`;
  }

  // Description
  if (enhancedDesc) {
    card += `
                <div style="font-size: 16px; line-height: 1.75; color: #E8E4DF;">
                  ${enhancedDesc}
                </div>`;
  }

  // Link
  if (sub.link) {
    card += `
                <div style="margin-top: 16px; padding-top: 8px;">
                  <a href="${escapeHtml(sub.link)}" target="_blank" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #C43A3A; text-decoration: none;">Details &#8594;</a>
                </div>`;
  }

  card += `
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  return card;
}

function buildEmailQuoteCard(sub, title, enhancedDesc) {
  let card = `
        <tr>
          <td style="padding: 12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding: 32px 24px; background-color: #141414; border-left: 4px solid #C43A3A;">`;

  if (title) {
    card += `
                  <h3 style="font-family: 'Playfair Display', Georgia, serif; font-size: 20px; font-style: italic; font-weight: 600; color: #E8E4DF; margin: 0 0 12px 0;">${title}</h3>`;
  }

  if (enhancedDesc) {
    card += `
                  <p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 18px; font-style: italic; color: #9A9189; line-height: 1.8; margin: 0;">${enhancedDesc}</p>`;
  }

  card += `
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  return card;
}

function buildEmailMinimalCard(sub, title, enhancedDesc) {
  let card = `
        <tr>
          <td style="padding: 8px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family: 'Playfair Display', Georgia, serif; font-size: 16px; font-weight: 500; color: #E8E4DF;">${title}</td>`;

  if (sub.start_date) {
    const dateStr = formatDate(sub.start_date, sub.end_time);
    card += `
                <td align="right" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; color: #9A9189; white-space: nowrap;">&#128197; ${escapeHtml(dateStr)}</td>`;
  }

  card += `
              </tr>
            </table>
          </td>
        </tr>`;

  if (enhancedDesc) {
    card += `
        <tr>
          <td style="padding: 0 0 4px 0;">
            <p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 13px; color: #9A9189; line-height: 1.6; margin: 0;">${enhancedDesc}</p>
          </td>
        </tr>`;
  }

  return card;
}

function buildEmailStoryCard(sub, title, enhancedDesc) {
  let card = `
        <tr>
          <td style="padding: 12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1A1A1A; border-left: 4px solid #C43A3A;">
              <tr>
                <td style="padding: 24px;">`;

  // Title + leader
  card += `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
                  <tr>
                    <td style="font-family: 'Playfair Display', Georgia, serif; font-size: 22px; font-weight: 700; line-height: 1.25; color: #E8E4DF;">${title}</td>`;

  if (sub.leader) {
    card += `
                    <td align="right" style="white-space: nowrap;">
                      <span style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: #C43A3A; background-color: rgba(196, 58, 58, 0.12); padding: 5px 11px; border-radius: 8px; border: 1px solid rgba(196, 58, 58, 0.15);">${escapeHtml(sub.leader)}</span>
                    </td>`;
  }

  card += `
                  </tr>
                </table>`;

  // Meta
  if (sub.start_date || sub.location) {
    card += `
                <table cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">`;

    if (sub.start_date) {
      const dateStr = formatDate(sub.start_date, sub.end_time);
      card += `
                  <tr>
                    <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189; padding-right: 24px;">&#128197; ${escapeHtml(dateStr)}</td>`;
    }

    if (sub.location) {
      card += `
                    <td style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 13px; color: #9A9189;">&#128205; ${escapeHtml(sub.location)}</td>`;
    }

    card += `
                  </tr>
                </table>`;
  }

  // Description
  if (enhancedDesc) {
    card += `
                <div style="font-size: 14px; line-height: 1.75; color: #E8E4DF;">
                  ${enhancedDesc}
                </div>`;
  }

  // Link
  if (sub.link) {
    card += `
                <div style="margin-top: 16px; padding-top: 8px;">
                  <a href="${escapeHtml(sub.link)}" target="_blank" style="font-family: 'DM Sans', 'Helvetica Neue', sans-serif; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #C43A3A; text-decoration: none;">Details &#8594;</a>
                </div>`;
  }

  card += `
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  return card;
}

// ─── 13. Interactive prompt ──────────────────────────────────────────
function interactivePrompt() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      rl.question('\n📋 Accept (A), Edit (E), Regenerate (R), or Quit (Q)? [A]: ', (answer) => {
        const choice = answer.trim().toUpperCase() || 'A';
        rl.close();
        resolve(choice);
      });
    };

    console.log('\n🌐 Opening newsletter preview in browser...');
    console.log('   Review the preview, then choose:');
    console.log('     A - Accept and write final files');
    console.log('     E - Edit variety-plan.json in $EDITOR, then re-render');
    console.log('     R - Regenerate via LLM');
    console.log('     Q - Quit without saving');

    prompt();
  });
}

// ─── 14. Open editor ─────────────────────────────────────────────────
function openEditor(filePath) {
  return new Promise((resolve, reject) => {
    const editor = process.env.EDITOR || 'vim';
    const proc = spawn(editor, [filePath], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Editor exited with code ${code}`));
    });

    proc.on('error', reject);
  });
}

// ─── 15. Open browser ────────────────────────────────────────────────
function openBrowser(filePath) {
  const url = 'file://' + filePath;
  let cmd;
  const platform = process.platform;

  if (platform === 'darwin') {
    cmd = ['open', url];
  } else if (platform === 'win32') {
    cmd = ['start', url];
  } else {
    cmd = ['xdg-open', url];
  }

  spawn(cmd[0], cmd.slice(1), { stdio: 'ignore' });
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const staticDataPath = resolve(__dirname, 'static-data.json');

  // Load static data
  console.log('📡 Loading static template data...');
  const staticData = loadStaticData(staticDataPath);
  console.log(`   Sections: ${staticData.sections.map(s => s.label).join(', ')}`);

  // Load submissions
  console.log('📡 Reading submission data from dev.db...');
  const submissions = getSubmissions(dbPath);
  console.log(`   Found ${submissions.length} submissions`);

  const sectionCounts = {};
  for (const sub of submissions) {
    const sec = sub.section || 'unclassified';
    sectionCounts[sec] = (sectionCounts[sec] || 0) + 1;
  }
  console.log('   Breakdown:');
  for (const [sec, count] of Object.entries(sectionCounts)) {
    const label = staticData.sections.find(s => s.id === sec)?.label || sec;
    console.log(`     ${label}: ${count}`);
  }

  // Load FNG stats
  console.log('📡 Loading FNG stats...');
  const fngStats = getFngStats(dbPath);
  console.log(`   2026 FNGs: ${fngStats.total2026}/${fngStats.goal} (${fngStats.progressPercent}%)`);

  // Load weekly FNGs
  console.log('📡 Fetching weekly FNGs from Google Sheets...');
  const weeklyFngs = await getWeeklyFngs();
  console.log(`   ${weeklyFngs.length} new FNGs this week`);

  // Load variety plan
  let varietyPlan = null;

  if (noLLM) {
    console.log('📡 No-LLM mode: using static rendering without variety plan');
  } else if (renderOnly) {
    // Render from existing plan file
    const planFile = customPlanPath || varietyPlanPath;
    if (!existsSync(planFile)) {
      console.error(`\n❌ Variety plan not found: ${planFile}`);
      console.error('   Run: node generate-newsletter.mjs (without --render) to generate one first');
      process.exit(1);
    }
    console.log(`📡 Loading variety plan from ${planFile}...`);
    varietyPlan = readVarietyPlan(planFile);
    console.log(`   ${varietyPlan.events.length} events, ${varietyPlan.sections.length} sections`);
  } else if (customPlanPath && existsSync(customPlanPath)) {
    console.log(`📡 Loading variety plan from ${customPlanPath}...`);
    varietyPlan = readVarietyPlan(customPlanPath);
    console.log(`   ${varietyPlan.events.length} events, ${varietyPlan.sections.length} sections`);
  } else if (regenerate) {
    // Need to generate via LLM
    console.log('📡 Building submissions context...');
    const submissionsContext = buildSubmissionsContext(submissions, fngStats);

    console.log(`📡 Calling Qwen LLM (${LLM_MODEL}) at ${LLM_BASE_URL}...`);
    try {
      varietyPlan = await callLLMForVarietyPlan(submissionsContext);
      console.log(`✅ Variety plan generated: ${submissions.length} events, ${varietyPlan.sections.length} sections`);
      console.log(`   Featured event: #${varietyPlan.featured_event_id} — "${varietyPlan.featured_reason}"`);

      // Write variety plan to file
      writeFileSync(varietyPlanPath, JSON.stringify(varietyPlan, null, 2), 'utf-8');
      console.log(`   Written to: ${varietyPlanPath}`);
    } catch (err) {
      console.error(`\n❌ LLM call failed: ${err.message}`);
      if (err.cause && err.cause.code === 'ECONNREFUSED') {
        console.error('   The local LLM server is not running. Start it and try again.');
      }
      console.error('\n   Fix the issue and run: node generate-newsletter.mjs');
      process.exit(1);
    }
  } else {
    // Default mode: try to load existing plan, or generate via LLM
    if (existsSync(varietyPlanPath)) {
      console.log('📡 Loading existing variety plan...');
      varietyPlan = readVarietyPlan(varietyPlanPath);
      console.log(`   ${varietyPlan.events.length} events, ${varietyPlan.sections.length} sections`);
      console.log('   To regenerate via LLM, run: node generate-newsletter.mjs --regenerate');
    } else {
      console.log('📡 No variety plan found. Generating via LLM...');
      console.log('📡 Building submissions context...');
      const submissionsContext = buildSubmissionsContext(submissions, fngStats);

      console.log(`📡 Calling Qwen LLM (${LLM_MODEL}) at ${LLM_BASE_URL}...`);
      try {
        varietyPlan = await callLLMForVarietyPlan(submissionsContext);
        console.log(`✅ Variety plan generated: ${submissions.length} events, ${varietyPlan.sections.length} sections`);
        console.log(`   Featured event: #${varietyPlan.featured_event_id} — "${varietyPlan.featured_reason}"`);

        writeFileSync(varietyPlanPath, JSON.stringify(varietyPlan, null, 2), 'utf-8');
        console.log(`   Written to: ${varietyPlanPath}`);
      } catch (err) {
        console.error(`\n❌ LLM call failed: ${err.message}`);
        if (err.cause && err.cause.code === 'ECONNREFUSED') {
          console.error('   The local LLM server is not running. Start it and try again.');
        }
        console.error('\n   Fix the issue and run: node generate-newsletter.mjs');
        process.exit(1);
      }
    }
  }

  // Build HTMLs
  console.log('🎨 Building web preview HTML...');
  const webHTML = buildWebHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
  writeFileSync(previewOutputPath, webHTML, 'utf-8');
  console.log(`   Written to: ${previewOutputPath} (${(webHTML.length / 1024).toFixed(1)} KB)`);

  console.log('📧 Building email HTML...');
  const emailHTML = buildEmailHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
  console.log(`   Email HTML size: ${(emailHTML.length / 1024).toFixed(1)} KB`);

  if (previewOnly) {
    console.log('\n✅ Preview mode: HTMLs generated, no final render.');
    console.log(`   Web preview: ${previewOutputPath}`);
    console.log(`   Email HTML:   (in memory, ${emailHTML.length / 1024} KB)`);
    console.log('\n   To write final files: node generate-newsletter.mjs --render');
    return;
  }

  // Auto-accept mode (for server/API usage — no interactive prompt)
  if (autoAccept) {
    writeFileSync(emailOutputPath, emailHTML, 'utf-8');
    console.log('\n✅ Auto-accepted. Writing final files...');
    console.log(`   Web preview: ${previewOutputPath}`);
    console.log(`   Email HTML:  ${emailOutputPath}`);
    console.log(`   Variety plan: ${varietyPlanPath}`);
    console.log(`\n   File sizes:`);
    console.log(`     Web: ${(webHTML.length / 1024).toFixed(1)} KB`);
    console.log(`     Email: ${(emailHTML.length / 1024).toFixed(1)} KB`);
    return;
  }

  // Open preview in browser
  openBrowser(previewOutputPath);

  // Interactive prompt
  const choice = await interactivePrompt();

  if (choice === 'Q') {
    console.log('\n👋 Quitting without saving. Preview files remain at:');
    console.log(`   ${previewOutputPath}`);
    return;
  }

  if (choice === 'E') {
    const planFile = customPlanPath || varietyPlanPath;
    console.log(`\n✏️  Opening ${planFile} in ${process.env.EDITOR || 'vim'}...`);
    console.log('   After editing, the HTMLs will be re-rendered automatically.');

    try {
      await openEditor(planFile);
      console.log('   Editor closed. Re-rendering HTMLs...');

      // Re-read the edited plan
      varietyPlan = readVarietyPlan(planFile);

      // Re-build HTMLs
      console.log('🎨 Re-building web preview HTML...');
      const webHTML = buildWebHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
      writeFileSync(previewOutputPath, webHTML, 'utf-8');

      console.log('📧 Re-building email HTML...');
      const emailHTML = buildEmailHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
      writeFileSync(emailOutputPath, emailHTML, 'utf-8');

      console.log(`   Email written to: ${emailOutputPath}`);
      console.log('\n   Preview updated. Review and choose again.');

      // Loop back to prompt
      const nextChoice = await interactivePrompt();
      if (nextChoice === 'A') {
        // Accept the updated version
        writeFileSync(emailOutputPath, emailHTML, 'utf-8');
        console.log('\n✅ Accepted! Final files written:');
        console.log(`   Web preview: ${previewOutputPath}`);
        console.log(`   Email HTML:  ${emailOutputPath}`);
      } else if (nextChoice === 'Q') {
        console.log('\n👋 Quitting. Preview files remain at:');
        console.log(`   ${previewOutputPath}`);
      } else {
        console.log('\n   Continuing from previous choice...');
      }
    } catch (err) {
      console.error(`\n❌ Editor error: ${err.message}`);
      console.log('   Try again or press Q to quit.');
    }
    return;
  }

  if (choice === 'R') {
    console.log('\n🔄 Regenerating via LLM...');
    console.log('📡 Building submissions context...');
    const submissionsContext = buildSubmissionsContext(submissions, fngStats);

    console.log(`📡 Calling Qwen LLM (${LLM_MODEL}) at ${LLM_BASE_URL}...`);
    try {
      varietyPlan = await callLLMForVarietyPlan(submissionsContext);
      console.log(`✅ New variety plan generated: ${submissions.length} events, ${varietyPlan.sections.length} sections`);

      writeFileSync(varietyPlanPath, JSON.stringify(varietyPlan, null, 2), 'utf-8');
      console.log(`   Written to: ${varietyPlanPath}`);

      // Re-render both HTMLs
      console.log('🎨 Re-building web preview HTML...');
      const webHTML = buildWebHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
      writeFileSync(previewOutputPath, webHTML, 'utf-8');
      console.log(`   Written to: ${previewOutputPath} (${(webHTML.length / 1024).toFixed(1)} KB)`);

      console.log('📧 Re-building email HTML...');
      const emailHTML = buildEmailHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
      writeFileSync(emailOutputPath, emailHTML, 'utf-8');
      console.log(`   Written to: ${emailOutputPath} (${(emailHTML.length / 1024).toFixed(1)} KB)`);

      // Open preview again
      openBrowser(previewOutputPath);

      // Loop back to prompt
      const nextChoice = await interactivePrompt();
      if (nextChoice === 'A') {
        console.log('\n✅ Accepted! Final files written:');
        console.log(`   Web preview: ${previewOutputPath}`);
        console.log(`   Email HTML:  ${emailOutputPath}`);
      } else if (nextChoice === 'Q') {
        console.log('\n👋 Quitting.');
      } else if (nextChoice === 'R') {
        console.log('\n🔄 Starting regeneration loop again...');
        // Could recurse, but let's just exit for simplicity
      } else if (nextChoice === 'E') {
        console.log('\n✏️  Opening variety plan for editing...');
        try {
          await openEditor(varietyPlanPath);
          varietyPlan = readVarietyPlan(varietyPlanPath);
          const webHTML = buildWebHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
          writeFileSync(previewOutputPath, webHTML, 'utf-8');
          const emailHTML = buildEmailHTML(staticData, submissions, fngStats, varietyPlan, weeklyFngs);
          writeFileSync(emailOutputPath, emailHTML, 'utf-8');
          console.log('\n✅ Accepted! Final files written:');
          console.log(`   Web preview: ${previewOutputPath}`);
          console.log(`   Email HTML:  ${emailOutputPath}`);
        } catch (err) {
          console.error(`❌ Editor error: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`\n❌ LLM call failed: ${err.message}`);
      if (err.cause && err.cause.code === 'ECONNREFUSED') {
        console.error('   The local LLM server is not running. Start it and try again.');
      }
      console.error('\n   Fix the issue and run: node generate-newsletter.mjs');
      process.exit(1);
    }
    return;
  }

  // Default: Accept (A)
  console.log('\n✅ Accepted! Writing final files...');
  writeFileSync(emailOutputPath, emailHTML, 'utf-8');
  console.log(`   Web preview: ${previewOutputPath}`);
  console.log(`   Email HTML:  ${emailOutputPath}`);
  console.log(`   Variety plan: ${varietyPlanPath}`);
  console.log(`\n   File sizes:`);
  console.log(`     Web: ${(webHTML.length / 1024).toFixed(1)} KB`);
  console.log(`     Email: ${(emailHTML.length / 1024).toFixed(1)} KB`);
}

main();
