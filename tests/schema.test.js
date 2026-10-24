const fs = require('fs');
const assert = require('assert');

function runSchemaTests() {
  console.log('--- Running Schema & SQL Migration Tests ---');
  const migrationPath = 'supabase/migrations/20261024000000_multiplayer_schema.sql';
  assert(fs.existsSync(migrationPath), 'Migration file not found');

  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify all 4 required tables
  const expectedTables = [
    'public.player_sessions',
    'public.matchmaking_queue',
    'public.matches',
    'public.match_moves'
  ];
  for (const table of expectedTables) {
    assert(sql.includes(`create table if not exists ${table}`), `Missing table definition: ${table}`);
    console.log(`  PASS: Table ${table} verified.`);
  }

  // Verify RLS enabled on each table
  for (const table of expectedTables) {
    assert(sql.includes(`alter table ${table} enable row level security;`), `RLS not enabled on ${table}`);
    console.log(`  PASS: RLS enabled on ${table}.`);
  }

  // Verify Constraints
  assert(sql.includes('player_id uuid not null unique references auth.users(id)'), 'Queue player uniqueness constraint missing');
  console.log('  PASS: Matchmaking queue unique player constraint verified.');

  assert(sql.includes('constraint uq_match_move_number unique (match_id, move_number)'), 'Idempotency constraint on match_moves missing');
  console.log('  PASS: Idempotency unique (match_id, move_number) verified.');

  // Verify Realtime publication
  assert(sql.includes('pubname = \'supabase_realtime\' and tablename = \'matchmaking_queue\''), 'Realtime publication for matchmaking_queue missing');
  assert(sql.includes('pubname = \'supabase_realtime\' and tablename = \'matches\''), 'Realtime publication for matches missing');
  assert(sql.includes('pubname = \'supabase_realtime\' and tablename = \'match_moves\''), 'Realtime publication for match_moves missing');
  console.log('  PASS: Realtime publications verified.');

  console.log('Schema & SQL Migration Tests Passed!\n');
}

module.exports = { runSchemaTests };

if (require.main === module) {
  runSchemaTests();
}
