const assert = require('assert');
const sessionHandler = require('../netlify/functions/session').handler;

async function runSessionFunctionTests() {
  console.log('--- Running Netlify Session Function Tests ---');

  // Test 1: OPTIONS Preflight
  const optRes = await sessionHandler({
    httpMethod: 'OPTIONS',
    headers: {}
  });
  assert.strictEqual(optRes.statusCode, 204, 'OPTIONS should return 204');
  console.log('  PASS: CORS preflight returns 204.');

  // Test 2: Missing Authorization header
  const noAuthRes = await sessionHandler({
    httpMethod: 'GET',
    headers: {}
  });
  assert.strictEqual(noAuthRes.statusCode, 401, 'Missing auth should return 401');
  const noAuthBody = JSON.parse(noAuthRes.body);
  assert.strictEqual(noAuthBody.success, false);
  console.log('  PASS: Missing authorization rejected with 401.');

  // Test 3: Malformed Authorization header
  const badAuthRes = await sessionHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Basic 12345' }
  });
  assert.strictEqual(badAuthRes.statusCode, 401, 'Basic auth should return 401');
  console.log('  PASS: Non-bearer authorization rejected with 401.');

  // Test 4: Empty Bearer token
  const emptyBearerRes = await sessionHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer   ' }
  });
  assert.strictEqual(emptyBearerRes.statusCode, 401, 'Empty bearer should return 401');
  console.log('  PASS: Empty bearer rejected with 401.');

  // Test 5: Unconfigured credentials returns 503
  const origUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  const noConfigRes = await sessionHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer mock-jwt-token' }
  });
  assert.strictEqual(noConfigRes.statusCode, 503, 'Unconfigured backend should return 503');
  process.env.SUPABASE_URL = origUrl;
  console.log('  PASS: Unconfigured environment cleanly returns 503.');

  console.log('Session Function Tests Passed!\n');
}

module.exports = { runSessionFunctionTests };

if (require.main === module) {
  runSessionFunctionTests();
}
