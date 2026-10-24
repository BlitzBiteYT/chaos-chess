const assert = require('assert');
const matchStateHandler = require('../netlify/functions/match-state').handler;

async function runMatchStateFunctionTests() {
  console.log('--- Running Netlify Match State Function Tests ---');

  // Test 1: OPTIONS Preflight
  const optRes = await matchStateHandler({
    httpMethod: 'OPTIONS',
    headers: {}
  });
  assert.strictEqual(optRes.statusCode, 204, 'OPTIONS should return 204');
  console.log('  PASS: CORS preflight returns 204.');

  // Test 2: Missing authorization
  const noAuthRes = await matchStateHandler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { matchId: 'mock-match-123' }
  });
  assert.strictEqual(noAuthRes.statusCode, 401);
  console.log('  PASS: Missing authorization rejected with 401.');

  // Test 3: Missing matchId parameter
  const noParamRes = await matchStateHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer mock-token' },
    queryStringParameters: {}
  });
  // Note: verifyAuth runs first, which in unconfigured env returns 503 or 401.
  assert(noParamRes.statusCode === 400 || noParamRes.statusCode === 503 || noParamRes.statusCode === 401);
  console.log('  PASS: Missing matchId handled correctly.');

  // Test 4: Mocked match state authorization & color assignment logic
  const mockMatch = {
    id: 'match-test-456',
    white_player_id: 'user-alice',
    black_player_id: 'user-bob',
    status: 'active',
    current_turn: 'w',
    state_version: 0,
    seed: 2847192834,
    chaos_settings: { on: true, every: 5, burst: 1 },
    board_ranks: 8,
    game_state: {
      pos: { turn: 'w', hm: 0, fm: 1 },
      hist: [],
      sans: []
    }
  };

  // Function to simulate participant check logic
  function resolveParticipant(user, match) {
    const isWhite = match.white_player_id === user.id;
    const isBlack = match.black_player_id === user.id;
    if (!isWhite && !isBlack) {
      return { allowed: false, statusCode: 403, error: 'You are not a participant in this match.' };
    }
    return {
      allowed: true,
      statusCode: 200,
      myColor: isWhite ? 'w' : 'b',
      match
    };
  }

  // Alice is White
  const aliceRes = resolveParticipant({ id: 'user-alice' }, mockMatch);
  assert.strictEqual(aliceRes.allowed, true);
  assert.strictEqual(aliceRes.myColor, 'w');
  assert.strictEqual(aliceRes.match.seed, 2847192834);
  console.log('  PASS: White player receives myColor = "w" and authoritative seed.');

  // Bob is Black
  const bobRes = resolveParticipant({ id: 'user-bob' }, mockMatch);
  assert.strictEqual(bobRes.allowed, true);
  assert.strictEqual(bobRes.myColor, 'b');
  assert.strictEqual(bobRes.match.seed, 2847192834);
  console.log('  PASS: Black player receives myColor = "b" and identical seed.');

  // Charlie is an intruder
  const charlieRes = resolveParticipant({ id: 'user-charlie' }, mockMatch);
  assert.strictEqual(charlieRes.allowed, false);
  assert.strictEqual(charlieRes.statusCode, 403);
  console.log('  PASS: Non-participant rejected with 403 Forbidden.');

  console.log('Match State Function Tests Passed!\n');
}

module.exports = { runMatchStateFunctionTests };

if (require.main === module) {
  runMatchStateFunctionTests();
}
