/**
 * Chaos Chess - Security & Validation Utilities
 * Enforces rate limiting, payload bounds, and input sanitization.
 */

// In-memory sliding window rate limiter per user/IP
const rateLimits = new Map(); // key -> [timestamps]

const WINDOW_MS = 10000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 30; // Max 30 requests per 10s

function checkRateLimit(identifier) {
  if (!identifier) return true;
  const now = Date.now();
  let timestamps = rateLimits.get(identifier) || [];
  timestamps = timestamps.filter(ts => now - ts < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    rateLimits.set(identifier, timestamps);
    return false; // Rate limit exceeded
  }

  timestamps.push(now);
  rateLimits.set(identifier, timestamps);
  return true;
}

function isValidUUID(id) {
  if (typeof id !== 'string') return false;
  // Match standard UUID or mock test ids like "m_123"
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
         /^[a-z0-9_-]{3,64}$/i.test(id);
}

function validateMovePayload(move, boardRanks = 8) {
  if (!move || typeof move !== 'object') return { valid: false, error: 'Move must be an object' };

  const { r, f, tr, tf, promo } = move;

  if (!Number.isInteger(r) || !Number.isInteger(f) ||
      !Number.isInteger(tr) || !Number.isInteger(tf)) {
    return { valid: false, error: 'Coordinates r, f, tr, tf must be integers' };
  }

  if (r < 0 || r >= boardRanks || tr < 0 || tr >= boardRanks ||
      f < 0 || f >= 8 || tf < 0 || tf >= 8) {
    return { valid: false, error: `Coordinates out of board bounds (0-${boardRanks - 1}, 0-7)` };
  }

  if (r === tr && f === tf) {
    return { valid: false, error: 'Origin and destination squares cannot be identical' };
  }

  if (promo !== undefined && promo !== null) {
    if (typeof promo !== 'string' || !['q', 'r', 'b', 'n'].includes(promo.toLowerCase())) {
      return { valid: false, error: 'Invalid promotion piece (must be q, r, b, or n)' };
    }
  }

  return { valid: true };
}

function validateActionPayload(action) {
  if (typeof action !== 'string') return { valid: false, error: 'Action must be a string' };
  const allowed = ['resign', 'offer_draw', 'accept_draw'];
  if (!allowed.includes(action)) {
    return { valid: false, error: `Invalid action. Allowed: ${allowed.join(', ')}` };
  }
  return { valid: true };
}

module.exports = {
  checkRateLimit,
  isValidUUID,
  validateMovePayload,
  validateActionPayload
};
