import assert from 'node:assert/strict';
import { test } from 'node:test';

const auth = await import('../src/auth.js');
const rateLimit = await import('../src/rateLimit.js');

test('session cookies can opt into the Secure flag without dropping HttpOnly defaults', () => {
  const expiresAt = '2026-04-20T00:00:00.000Z';

  const insecureCookie = auth.createSessionCookie('session-id', expiresAt, false);
  const secureCookie = auth.createSessionCookie('session-id', expiresAt, true);
  const clearedCookie = auth.clearSessionCookie(true);

  assert.match(insecureCookie, /HttpOnly/);
  assert.doesNotMatch(insecureCookie, /;\sSecure/);
  assert.match(secureCookie, /;\sSecure/);
  assert.match(secureCookie, /SameSite=Lax/);
  assert.match(clearedCookie, /;\sSecure/);
});

test('rate limiting caps repeated requests inside the active window', () => {
  rateLimit.__resetRateLimitsForTests();

  const first = rateLimit.consumeRateLimit({
    scope: 'messages:post',
    identifier: '127.0.0.1',
    limit: 2,
    windowMs: 60_000
  });
  const second = rateLimit.consumeRateLimit({
    scope: 'messages:post',
    identifier: '127.0.0.1',
    limit: 2,
    windowMs: 60_000
  });
  const third = rateLimit.consumeRateLimit({
    scope: 'messages:post',
    identifier: '127.0.0.1',
    limit: 2,
    windowMs: 60_000
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.ok(third.resetAt >= second.resetAt);
});
