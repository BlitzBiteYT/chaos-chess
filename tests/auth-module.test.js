const assert = require('assert');
const Auth = require('../src/online/auth');

async function runAuthModuleTests() {
  console.log('--- Running Client Auth Module Tests ---');

  // Verify exports
  assert.strictEqual(typeof Auth.initAuth, 'function');
  assert.strictEqual(typeof Auth.getPlayer, 'function');
  assert.strictEqual(typeof Auth.getAccessToken, 'function');
  assert.strictEqual(typeof Auth.signOut, 'function');
  assert.strictEqual(typeof Auth.onAuthStateChange, 'function');
  console.log('  PASS: Auth module interface verified.');

  // Test unconfigured behavior
  const unconfiguredRes = await Auth.initAuth();
  assert.strictEqual(unconfiguredRes.success, false);
  assert(unconfiguredRes.error.includes('credentials not configured'), 'Reports unconfigured error');
  console.log('  PASS: Unconfigured client auth handled safely.');

  // Test with mock Supabase instance
  const mockUser = { id: 'usr-1234-abcd', is_anonymous: true, user_metadata: { display_name: 'Test Guest' } };
  const mockSession = { access_token: 'jwt.token.here', user: mockUser };
  const mockClient = {
    auth: {
      getSession: async () => ({ data: { session: mockSession }, error: null }),
      signInAnonymously: async () => ({ data: { user: mockUser, session: mockSession }, error: null }),
      signOut: async () => {},
      onAuthStateChange: () => {}
    }
  };

  const TestAuth = (function() {
    return Auth;
  })();

  // Simulating player session retrieval
  assert.strictEqual(Auth.getPlayer(), null, 'Initially no player logged in');
  console.log('  PASS: Auth initial player state is null.');

  console.log('Client Auth Module Tests Passed!\n');
}

module.exports = { runAuthModuleTests };

if (require.main === module) {
  runAuthModuleTests();
}
