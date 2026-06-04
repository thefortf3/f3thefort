import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  leader: text('leader'),
  start_date: text('start_date').notNull(),
  end_time: text('end_time'),
  location: text('location'),
  description: text('description').notNull(),
  link: text('link'),
  hero_image: text('hero_image'),
  video_url: text('video_url'),
  section: text('section'),
  position: integer('position').default(0),
  submitter_name: text('submitter_name'),
  submitter_email: text('submitter_email'),
  submitter_phone: text('submitter_phone'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  archived_at: text('archived_at'),
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
