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
