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
  section: text('section'),
  submitter_name: text('submitter_name'),
  submitter_email: text('submitter_email'),
  submitter_phone: text('submitter_phone'),
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
