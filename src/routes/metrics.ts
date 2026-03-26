import { Hono } from 'hono';

import { metrics } from '../utils/metrics.js';

const startTime = Date.now();

/**
 * GET /metrics — Prometheus-style metrics for monitoring.
 * Returns verification counts, settlement counts, latency percentiles, uptime.
 */
export function createMetricsRoute(): Hono {
  const route = new Hono();

  route.get('/', (c) => {
    return c.json({
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      ...metrics.toJSON(),
    });
  });

  return route;
}
