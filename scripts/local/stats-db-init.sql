-- Local stand-in for the stats Supabase project (docker-compose.local.yml, profile "stats"):
-- the roles Supabase's REST API (PostgREST) uses, with Supabase's limits. Runs once, when the
-- stats-db volume is first created. Tables and data come from scripts/local/seed-stats-db.sh.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'local-authenticator';
GRANT anon, authenticated, service_role TO authenticator;

-- Supabase's per-role statement timeouts (PostgREST applies them to the role it switches to).
ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE authenticator SET statement_timeout = '8s';

-- As on Supabase: the API roles may use the public schema; row-level security decides the rest.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
