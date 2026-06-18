#!/usr/bin/env node
/**
 * import-fngs.mjs
 *
 * Imports FNG data from Google Sheet CSV into the fngs table.
 * Usage: node import-fngs.mjs [--db dev.db]
 */

import Database from 'better-sqlite3';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    header.forEach((h, idx) => { row[h] = fields[idx] || ''; });
    rows.push(row);
  }

  return rows;
}

export async function importFngs(dbPath, sheetUrl) {
  const response = await fetch(sheetUrl);
  if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);

  const csvText = await response.text();
  const rows = parseCSV(csvText);

  const db = new Database(dbPath);

  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fngs'").get();
  if (!tableExists) {
    db.exec('CREATE TABLE fngs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, first_name TEXT, last_name TEXT, email TEXT, f3_name TEXT, ehed_by TEXT, workout_q_f3_name TEXT, ao TEXT, phone_number TEXT, year INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  }

  db.prepare('DELETE FROM fngs').run();

  const insert = db.prepare(`
    INSERT INTO fngs (timestamp, first_name, last_name, email, f3_name, ehed_by, workout_q_f3_name, ao, phone_number, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((entries) => {
    for (const entry of entries) {
      const date = new Date(entry['Timestamp']);
      const year = isNaN(date.getTime()) ? null : date.getFullYear();
      insert.run(
        entry['Timestamp'],
        entry['First Name'],
        entry['Last Name'],
        entry['Email'],
        entry['F3 Name'],
        entry["EH'ed By"] || entry['EHed By'] || null,
        entry["Workout Q's F3 Name"] || entry['Workout Q F3 Name'] || null,
        entry['AO'],
        entry['Phone Number'] || null,
        year
      );
    }
  });

  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    batch(rows.slice(i, i + batchSize));
  }

  db.close();
  return { inserted: rows.length };
}

// ─── CLI entry point ─────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  import('dotenv/config').then(async () => {
    const args = process.argv.slice(2);
    const dbFlag = args.find(a => a.startsWith('--db=')) || args.find(a => a.startsWith('--db'));
    const dbPath = dbFlag
      ? dbFlag.replace('--db=', '').replace('--db ', '')
      : resolve(__dirname, '..', 'dev.db');

    const sheetUrl = process.env.FNG_SHEET_URL;
    if (!sheetUrl) { console.error('❌ FNG_SHEET_URL not set in .env'); process.exit(1); }

    console.log('📡 Fetching FNG data from Google Sheets...');
    const { inserted } = await importFngs(dbPath, sheetUrl);
    console.log(`\n✅ Imported ${inserted} FNG entries into ${dbPath}`);

    const db2 = new Database(dbPath);
    const years = db2.prepare('SELECT year, COUNT(*) as cnt FROM fngs GROUP BY year ORDER BY year').all();
    console.log('   Year breakdown:');
    for (const y of years) console.log(`     ${y.year}: ${y.cnt}`);
    db2.close();
  });
}
