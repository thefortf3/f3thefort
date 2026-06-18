#!/usr/bin/env node
/**
 * generate-variety.mjs
 *
 * Queries DB for submissions + static data, calls local Qwen LLM
 * to generate a variety plan, and outputs variety-plan.json.
 *
 * Usage:
 *   node generate-variety.mjs              # Generate and write variety-plan.json
 *   node generate-variety.mjs --stdout     # Output JSON to stdout
 *   node generate-variety.mjs --dry-run    # Show prompt without calling LLM
 */

import Database from 'better-sqlite3';
import { generateObject } from 'ai';
import { z } from 'zod';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outputFlag = args.find(a => a.startsWith('--output=')) || args.find(a => a.startsWith('--output'));
const outputPath = outputFlag
  ? outputFlag.replace('--output=', '').replace('--output ', '')
  : resolve(__dirname, '..', 'variety-plan.json');
const stdoutOnly = args.includes('--stdout');
const dryRun = args.includes('--dry-run');

// ─── LLM config ──────────────────────────────────────────────────────
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://aibot:13305/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'user.Qwen3.6-35B-A3B-MOE-Thinking';
const LLM_TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || '0.7');

// ─── Zod schema for variety plan ─────────────────────────────────────
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
    total2026: total2026.total,
    remaining: Math.max(0, goal - total2026.total),
    onTrack: total2026.total >= expectedFngs,
    progressPercent: Math.round((total2026.total / goal) * 100),
  };
}

// ─── 4. Format dates from DB datetime-local format ───────────────────
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

// ─── 5. Build issue date ─────────────────────────────────────────────
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

// ─── 6. Build submissions context for LLM ────────────────────────────
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

  // FNG stats
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

// ─── 7. Build LLM prompt ─────────────────────────────────────────────
function buildPrompt(submissionsContext) {
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

  return {
    system: systemPrompt,
    user: `Here are this week's submissions:\n\n${submissionsContext}\n\nGenerate a variety plan following the output schema. Return valid JSON only.`,
  };
}

// ─── 8. Call LLM ─────────────────────────────────────────────────────
async function callLLM(systemPrompt, userPrompt) {
  const provider = createOpenAICompatible({
    name: 'f3-openai',
    baseURL: LLM_BASE_URL,
    apiKey: 'local',
  });

  const model = provider.languageModel(LLM_MODEL);

  const { object, warnings } = await generateObject({
    model,
    schema: VarietyPlanSchema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: LLM_TEMPERATURE,
    maxTokens: 4096,
  });

  return { object, warnings };
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  const dbPathArg = args.find(a => a.startsWith('--db=')) || args.find(a => a.startsWith('--db'));
  const dbPath = dbPathArg
    ? dbPathArg.replace('--db=', '').replace('--db ', '')
    : (process.env.TEST_DB || resolve(__dirname, '..', 'dev.db'));

  const staticDataPath = resolve(__dirname, '..', 'data', 'static-data.json');

  console.log('📡 Loading static template data...');
  const staticData = loadStaticData(staticDataPath);
  console.log(`   Sections: ${staticData.sections.map(s => s.label).join(', ')}`);

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

  console.log('📡 Loading FNG stats...');
  const fngStats = getFngStats(dbPath);
  console.log(`   2026 FNGs: ${fngStats.total2026}/${fngStats.goal} (${fngStats.progressPercent}%)`);

  console.log('📡 Building submissions context...');
  const submissionsContext = buildSubmissionsContext(submissions, fngStats);

  const { system, user } = buildPrompt(submissionsContext);

  if (dryRun) {
    console.log('\n=== DRY RUN — Prompt would be sent to LLM ===\n');
    console.log('System:', system);
    console.log('\nUser:', user);
    console.log('\n=== End of prompt ===');
    return;
  }

  console.log(`📡 Calling Qwen LLM (${LLM_MODEL}) at ${LLM_BASE_URL}...`);

  try {
    const { object: varietyPlan, warnings } = await callLLM(system, user);

    if (warnings && warnings.length > 0) {
      console.log('⚠️  LLM warnings:', warnings);
    }

    console.log(`✅ Variety plan generated: ${submissions.length} events, ${varietyPlan.sections.length} sections`);
    console.log(`   Featured event: #${varietyPlan.featured_event_id} — "${varietyPlan.featured_reason}"`);
    console.log(`   Format distribution:`);
    const formatCounts = {};
    for (const ev of varietyPlan.events) {
      formatCounts[ev.format] = (formatCounts[ev.format] || 0) + 1;
    }
    for (const [fmt, count] of Object.entries(formatCounts)) {
      console.log(`     ${fmt}: ${count}`);
    }

    if (stdoutOnly) {
      console.log(JSON.stringify(varietyPlan, null, 2));
    } else {
      writeFileSync(outputPath, JSON.stringify(varietyPlan, null, 2), 'utf-8');
      console.log(`   Written to: ${outputPath}`);
    }
  } catch (err) {
    console.error(`\n❌ LLM call failed: ${err.message}`);
    if (err.cause && err.cause.code === 'ECONNREFUSED') {
      console.error('   The local LLM server is not running. Start it and try again.');
    }
    process.exit(1);
  }
}

// Import createOpenAICompatible from @ai-sdk/openai-compatible
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

main();
