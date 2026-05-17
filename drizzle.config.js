import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './schema.js',
  out: './drizzle',
  dbCredentials: {
    url: './dev.db',
  },
});
