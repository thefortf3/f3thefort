#!/usr/bin/env node
/**
 * Unit tests for the in-memory rate limiter (lib/rate-limit.js).
 *
 * Run:  node --test tests/rate-limit.unit.js
 */

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { rateLimit } from '../lib/rate-limit.js';

/** Minimal Express req/res doubles for exercising the middleware. */
function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/** Drive one request through the middleware; returns true if next() was called (allowed). */
function call(mw, ip, res = mockRes()) {
  let allowed = false;
  mw({ ip }, res, () => { allowed = true; });
  return { allowed, res };
}

describe('rateLimit', () => {
  it('allows requests up to the limit then blocks with 429', () => {
    const mw = rateLimit({ windowMs: 1000, max: 3 });
    let allowedCount = 0;
    let blocked;
    for (let i = 0; i < 5; i++) {
      const { allowed, res } = call(mw, '1.1.1.1');
      if (allowed) allowedCount++;
      else blocked = res;
    }
    equal(allowedCount, 3, 'exactly max requests allowed');
    equal(blocked.statusCode, 429, 'over-limit returns 429');
    ok(blocked.body?.error, 'error message present');
    ok(blocked.headers['Retry-After'], 'Retry-After header set');
  });

  it('tracks limits independently per IP', () => {
    const mw = rateLimit({ windowMs: 1000, max: 1 });
    ok(call(mw, '2.2.2.2').allowed, 'first IP first request allowed');
    ok(!call(mw, '2.2.2.2').allowed, 'first IP second request blocked');
    ok(call(mw, '3.3.3.3').allowed, 'different IP unaffected');
  });

  it('resets the window after it expires', async () => {
    const mw = rateLimit({ windowMs: 40, max: 1 });
    ok(call(mw, '4.4.4.4').allowed, 'first request allowed');
    ok(!call(mw, '4.4.4.4').allowed, 'second request blocked within window');
    await new Promise((r) => setTimeout(r, 60));
    ok(call(mw, '4.4.4.4').allowed, 'allowed again after window resets');
  });

  it('uses a custom message when provided', () => {
    const mw = rateLimit({ windowMs: 1000, max: 0, message: 'slow down friend' });
    const { res } = call(mw, '5.5.5.5');
    equal(res.body.error, 'slow down friend');
  });
});
