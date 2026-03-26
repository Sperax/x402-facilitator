import { Hono } from 'hono';

import type { Facilitator } from '../core/facilitator.js';
import type { FacilitatorConfig } from '../types/index.js';
import { getNetworkName } from '../config/chains.js';
import { getTokensForChain } from '../config/tokens.js';

/**
 * GET /.well-known/x402 — Standard x402 protocol discovery endpoint.
 * Allows clients and crawlers to discover this facilitator's capabilities.
 */
export function createWellKnownRoute(facilitator: Facilitator, config: FacilitatorConfig): Hono {
  const route = new Hono();

  route.get('/', (c) => {
    const kinds = config.chains.flatMap((chain) => {
      const tokens = getTokensForChain(chain.chainId);
      return tokens.map((token) => ({
        x402Version: 1,
        scheme: 'exact' as const,
        network: getNetworkName(chain.chainId),
        asset: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
      }));
    });

    return c.json({
      x402Version: 1,
      facilitator: {
        name: 'SperaxOS x402 Facilitator',
        address: facilitator.getAddress(),
        operator: {
          name: 'SperaxOS',
          url: 'https://chat.sperax.io',
          website: 'https://sperax.io',
        },
      },
      endpoints: {
        verify: '/verify',
        settle: '/settle',
        supported: '/supported',
        health: '/health',
        info: '/info',
        metrics: '/metrics',
        balances: '/balances',
        fees: '/fees',
        status: '/status/:txHash',
      },
      supportedPaymentKinds: kinds,
    });
  });

  return route;
}
