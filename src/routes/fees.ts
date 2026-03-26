import { Hono } from 'hono';
import { createPublicClient, http, formatUnits, formatGwei } from 'viem';
import { base, arbitrum, mainnet, baseSepolia, arbitrumSepolia } from 'viem/chains';

import type { FacilitatorConfig, SupportedChainId } from '../types/index.js';
import { getNetworkName } from '../config/chains.js';

const viemChains: Record<number, any> = {
  1: mainnet,
  8453: base,
  84532: baseSepolia,
  42161: arbitrum,
  421614: arbitrumSepolia,
};

// Approximate gas for transferWithAuthorization
const ESTIMATED_GAS = 80_000n;

export function createFeesRoute(config: FacilitatorConfig): Hono {
  const route = new Hono();

  route.get('/', async (c) => {
    const chainFees = await Promise.all(
      config.chains.map(async (chain) => {
        const client = createPublicClient({
          chain: viemChains[chain.chainId],
          transport: http(chain.rpcUrl),
        });

        try {
          const gasPrice = await client.getGasPrice();
          const estimatedCostWei = gasPrice * ESTIMATED_GAS;

          return {
            chainId: chain.chainId as SupportedChainId,
            network: getNetworkName(chain.chainId),
            gasPrice: formatGwei(gasPrice) + ' gwei',
            estimatedSettlementCost: {
              eth: formatUnits(estimatedCostWei, 18),
              wei: estimatedCostWei.toString(),
              gasUnits: ESTIMATED_GAS.toString(),
            },
          };
        } catch {
          return {
            chainId: chain.chainId as SupportedChainId,
            network: getNetworkName(chain.chainId),
            error: 'Failed to fetch gas price',
          };
        }
      }),
    );

    return c.json({ chains: chainFees });
  });

  return route;
}
