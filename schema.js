import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  leader: text('leader'),
  start_date: text('start_date').default(''),
  start_time: text('start_time'),
  end_time: text('end_time'),
  location: text('location'),
  description: text('description').notNull(),
  link: text('link'),
  hero_image: text('hero_image'),
  video_url: text('video_url'),
  preblast_url: text('preblast_url'),
  preblast_content: text('preblast_content'),
  section: text('section'),
  position: integer('position').default(0),
  show_in_upcoming: integer('show_in_upcoming').default(0),
  submitter_name: text('submitter_name'),
  submitter_email: text('submitter_email'),
  submitter_phone: text('submitter_phone'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  archived_at: text('archived_at'),
  // Approval + entries model (see lib/entries.js; dates live in the `occurrences` table)
  status: text('status'),
  slug: text('slug'),
  summary: text('summary'),
  featured: integer('featured').default(0),
  hold_from_newsletter: integer('hold_from_newsletter').default(0),
  approved_at: text('approved_at'),
  reject_reason: text('reject_reason'),
  updated_at: text('updated_at'),
  preblast_requested: integer('preblast_requested').default(0),
  origin: text('origin'),
});

export const occurrences = sqliteTable('occurrences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submission_id: integer('submission_id').notNull(),
  date: text('date').notNull(),
  start_time: text('start_time'),
  end_time: text('end_time'),
  position: integer('position').default(0),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  slug: text('slug').notNull(),
  color: text('color'),
  position: integer('position').default(0),
  legacy_section: text('legacy_section'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const submission_tags = sqliteTable('submission_tags', {
  submission_id: integer('submission_id').notNull(),
  tag_id: integer('tag_id').notNull(),
});

export const region_settings = sqliteTable('region_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const sections = sqliteTable('sections', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  accent: text('accent').notNull(),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const newsletter_sends = sqliteTable('newsletter_sends', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaign_id: text('campaign_id'),
  subject: text('subject'),
  from_name: text('from_name'),
  from_email: text('from_email'),
  status: text('status').notNull(), // 'sent', 'preview_sent', 'failed'
  error_message: text('error_message'),
  recipient_count: integer('recipient_count').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const audit_log = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submission_id: integer('submission_id'),
  action: text('action').notNull(), // 'created' | 'updated' | 'moved' | 'archived' | 'restored' | 'deleted'
  detail: text('detail'),           // JSON string with relevant change info
  submission_title: text('submission_title'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const three_fs_items = sqliteTable('three_fs_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  f_column: text('f_column').notNull(), // 'fitness' | 'fellowship' | 'faith'
  item_type: text('item_type').notNull().default('event'), // 'event' | 'link'
  name: text('name'),
  detail: text('detail'),
  link_url: text('link_url'),
  link_label: text('link_label'),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const slt_entries = sqliteTable('slt_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  role: text('role').notNull(),
  name: text('name').notNull(),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const helpful_links = sqliteTable('helpful_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const vqs = sqliteTable('vqs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ao: text('ao').notNull(),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const shovel_flags = sqliteTable('shovel_flags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  from_name: text('from_name').notNull(),
  to_name: text('to_name').notNull(),
  ao: text('ao').notNull(),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const recurring_events = sqliteTable('recurring_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(),
  time: text('time'),
  name: text('name').notNull(),
  location: text('location'),
  note: text('note'),
  blurb: text('blurb'),
  link_url: text('link_url'),
  event_date: text('event_date'),
  position: integer('position').default(0),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const fngs = sqliteTable('fngs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp'),
  first_name: text('first_name'),
  last_name: text('last_name'),
  email: text('email'),
  f3_name: text('f3_name'),
  ehed_by: text('ehed_by'),
  workout_q_f3_name: text('workout_q_f3_name'),
  ao: text('ao'),
  phone_number: text('phone_number'),
  year: integer('year'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
