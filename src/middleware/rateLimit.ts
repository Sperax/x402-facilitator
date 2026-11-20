import type { MiddlewareHandler } from 'hono';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { clientAddress } from './forwarded.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_CLIENTS = 10_000;

/**
 * Fixed-window in-memory rate limiter keyed by client address.
 * The address comes from the proxy-appended X-Forwarded-For hop
 * (`TRUSTED_PROXY_HOPS`), so clients cannot rotate keys by spoofing the header.
 * Accepts optional overrides; falls back to env config.
 */
export function rateLimitMiddleware(
  max?: number,
  windowMs?: number,
  trustedHops?: number,
): MiddlewareHandler {
  const store = new Map<string, RateLimitEntry>();
  const maxRequests = max ?? env.RATE_LIMIT_MAX;
  const windowMsVal = windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const hops = trustedHops ?? env.TRUSTED_PROXY_HOPS;

  return async (c, next) => {
    const key = clientAddress(c.req.header('x-forwarded-for'), hops);
    const now = Date.now();

    if (store.size > MAX_TRACKED_CLIENTS) {
      for (const [k, e] of store) if (now > e.resetAt) store.delete(k);
    }

    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMsVal });
    } else {
      entry.count++;
      if (entry.count > maxRequests) {
        logger.warn({ client: key }, 'Rate limit exceeded');
        c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return c.json({ error: 'Too many requests' }, 429);
      }
    }

    await next();
  };
}
