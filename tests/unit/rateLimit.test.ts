import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../src/config/env.js', () => ({
  env: { RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60_000, TRUSTED_PROXY_HOPS: 1 },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { clientAddress } from '../../src/middleware/forwarded.js';
import { rateLimitMiddleware } from '../../src/middleware/rateLimit.js';

describe('clientAddress', () => {
  it('takes the entry appended by the trusted proxy', () => {
    expect(clientAddress('1.1.1.1, 2.2.2.2, 3.3.3.3', 1)).toBe('3.3.3.3');
    expect(clientAddress('1.1.1.1, 2.2.2.2, 3.3.3.3', 2)).toBe('2.2.2.2');
  });

  it('ignores the header when no proxy is trusted or the chain is too short', () => {
    expect(clientAddress('1.1.1.1', 0)).toBe('direct');
    expect(clientAddress('1.1.1.1', 2)).toBe('direct');
    expect(clientAddress(undefined, 1)).toBe('direct');
  });
});

describe('rateLimitMiddleware', () => {
  function app() {
    const a = new Hono();
    a.use('*', rateLimitMiddleware());
    a.get('/', (c) => c.text('ok'));
    return a;
  }

  it('cannot be bypassed by rotating a spoofed left-most X-Forwarded-For hop', async () => {
    const a = app();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await a.request('/', { headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('sends Retry-After with the 429', async () => {
    const a = app();
    const headers = { 'x-forwarded-for': '198.51.100.1' };
    await a.request('/', { headers });
    await a.request('/', { headers });
    const res = await a.request('/', { headers });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('keeps separate budgets for distinct clients', async () => {
    const a = app();
    for (let i = 0; i < 2; i++) await a.request('/', { headers: { 'x-forwarded-for': '198.51.100.2' } });
    const res = await a.request('/', { headers: { 'x-forwarded-for': '198.51.100.3' } });
    expect(res.status).toBe(200);
  });
});
