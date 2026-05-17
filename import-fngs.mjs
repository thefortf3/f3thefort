#!/usr/bin/env node
/**
 * import-fngs.mjs
 * 
 * Imports FNG data from Google Sheet CSV into the fngs table.
 * Usage: node import-fngs.mjs [--db dev.db]
 */

import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dbFlag = args.find(a => a.startsWith('--db=')) || args.find(a => a.startsWith('--db'));
const dbPath = dbFlag
  ? dbFlag.replace('--db=', '').replace('--db ', '')
  : resolve(__dirname, 'dev.db');

const sheetUrl = process.env.FNG_SHEET_URL;
if (!sheetUrl) {
  console.error('❌ FNG_SHEET_URL not set in .env');
  process.exit(1);
}

// ─── Parse CSV ───────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields with commas
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

// ─── Import ──────────────────────────────────────────────────────────
console.log('📡 Fetching FNG data from Google Sheets...');
const response = await fetch(sheetUrl);
if (!response.ok) {
  console.error(`❌ Failed to fetch CSV: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const csvText = await response.text();
const rows = parseCSV(csvText);
console.log(`   Found ${rows.length} FNG entries`);

console.log('📡 Connecting to database...');
const db = new Database(dbPath);

// Check if table exists
const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fngs'").get();
if (!tableExists) {
  console.log('   Creating fngs table...');
  db.exec('CREATE TABLE fngs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, first_name TEXT, last_name TEXT, email TEXT, f3_name TEXT, ehed_by TEXT, workout_q_f3_name TEXT, ao TEXT, phone_number TEXT, year INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
}

// Clear existing data
const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM fngs').get();
if (existingCount.cnt > 0) {
  console.log(`   Clearing ${existingCount.cnt} existing FNG entries...`);
  db.prepare('DELETE FROM fngs').run();
}

// Insert data
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
      entry['Workout Q\'s F3 Name'] || entry['Workout Q F3 Name'] || null,
      entry['AO'],
      entry['Phone Number'] || null,
      year
    );
  }
});

const batchSize = 100;
let inserted = 0;
for (let i = 0; i < rows.length; i += batchSize) {
  const batchRows = rows.slice(i, i + batchSize);
  batch(batchRows);
  inserted += batchRows.length;
  console.log(`   Imported ${inserted}/${rows.length} entries...`);
}

db.close();
console.log(`\n✅ Imported ${inserted} FNG entries into dev.db`);

// Show year breakdown
const db2 = new Database(dbPath);
const years = db2.prepare('SELECT year, COUNT(*) as cnt FROM fngs GROUP BY year ORDER BY year').all();
console.log('   Year breakdown:');
for (const y of years) {
  console.log(`     ${y.year}: ${y.cnt}`);
}
db2.close();
