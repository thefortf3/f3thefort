-- ============================================================
-- F3 The Fort — east/west division seed for ao_dim.east_west
-- ============================================================
-- Run AFTER supabase-setup.sql (and, ideally, after the first sync so the
-- ao_dim rows exist — though ON CONFLICT handles either order).
--
-- east_west is region-specific and hand-maintained. syncAoDim() never touches
-- this column, so re-running the sync will not clobber these values.
-- When a new AO opens, add a line here and re-run, or set it in the table editor.
--
-- Source: the old SQLite orgs.east_west (commit 2f1c88d), keyed by F3 Nation
-- ao_org_id. Multiple ids per AO = active AO + its deactivated predecessors.
-- ============================================================

INSERT INTO ao_dim (ao_org_id, ao_name, east_west) VALUES
  -- ── EAST ──────────────────────────────────────────────
  (47702, 'Block Party',  'east'),
  (51942, 'Block Party',  'east'),
  (49797, 'Bushwood',     'east'),
  (50766, 'Bushwood',     'east'),
  (34665, 'Clydesdales',  'east'),
  (34658, 'Coaches Box',  'east'),
  (51939, 'Cockpit',      'east'),
  (49689, 'Dawn Patrol',  'east'),
  (49690, 'Dawn Patrol',  'east'),
  (49794, 'Dawn Patrol',  'east'),
  (45117, 'Lazarus',      'east'),
  (52166, 'Minnow Pond',  'east'),
  (34668, 'Ring of Fire', 'east'),
  (49685, 'Seabiscuit',   'east'),
  (47302, 'Snake Pit',    'east'),
  (34656, 'The Fort',     'east'),
  (34652, 'The Hive',     'east'),
  (37515, 'The Yard',     'east'),
  (42570, 'The Yard',     'east'),
  -- ── WEST ──────────────────────────────────────────────
  (51941, '6 @ 6',         'west'),
  (34671, 'Alcatraz',      'west'),
  (50317, 'Chester',       'west'),
  (34661, 'Colosseum',     'west'),
  (32851, 'Currahee',      'west'),
  (34654, 'Flight Plan',   'west'),
  (34666, 'Kitchen Sink',  'west'),
  (52521, 'Q Source',      'west'),
  (34651, 'Slow Burn',     'west'),
  (44479, 'Soul to Sole',  'west'),
  (32852, 'Sweep The Leg', 'west'),
  (34655, 'The Armory',    'west'),
  (34663, 'The Ballroom',  'west'),
  (51940, 'The Forge',     'west'),
  (52229, 'Training Ground','west')
ON CONFLICT (ao_org_id) DO UPDATE SET east_west = EXCLUDED.east_west;
