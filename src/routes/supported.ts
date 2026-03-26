import { Hono } from 'hono';

import type { FacilitatorConfig } from '../types/index.js';
import { getTokensForChain } from '../config/tokens.js';

/**
 * GET /supported — returns payment kinds supported by this facilitator.
 * Required by the x402 SDK for discovery.
 */
export function createSupportedRoute(config: FacilitatorConfig): Hono {
  const route = new Hono();

  route.get('/', (c) => {
    const kinds = config.chains.flatMap((chain) => {
      const tokens = getTokensForChain(chain.chainId);
      return tokens.map((token) => ({
        x402Version: 1,
        scheme: 'exact' as const,
        network: `eip155:${chain.chainId}`,
        token: token.address,
        extra: {
          name: token.symbol,
          decimals: token.decimals,
        },
      }));
    });

    return c.json({ kinds });
  });

  return route;
}
