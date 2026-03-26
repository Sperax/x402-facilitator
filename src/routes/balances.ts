import { Hono } from 'hono';
import { createPublicClient, http, formatEther, formatUnits } from 'viem';
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

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * GET /balances — Returns the facilitator wallet's ETH + USDC balances on each enabled chain.
 * Useful for monitoring gas availability and USDC holdings.
 */
export function createBalancesRoute(config: FacilitatorConfig, facilitatorAddress: `0x${string}`): Hono {
  const route = new Hono();

  route.get('/', async (c) => {
    const balances = await Promise.all(
      config.chains.map(async (chain) => {
        try {
          const client = createPublicClient({
            chain: viemChains[chain.chainId],
            transport: http(chain.rpcUrl),
          });

          const [ethBalance, usdcBalance] = await Promise.all([
            client.getBalance({ address: facilitatorAddress }),
            client.readContract({
              address: chain.usdcAddress,
              abi: ERC20_BALANCE_ABI,
              functionName: 'balanceOf',
              args: [facilitatorAddress],
            }),
          ]);

          const ethFormatted = formatEther(ethBalance);
          const lowGas = parseFloat(ethFormatted) < 0.001;

          return {
            chainId: chain.chainId as SupportedChainId,
            network: getNetworkName(chain.chainId),
            eth: {
              balance: ethFormatted,
              wei: ethBalance.toString(),
            },
            usdc: {
              balance: formatUnits(usdcBalance as bigint, 6),
              raw: (usdcBalance as bigint).toString(),
            },
            lowGas,
          };
        } catch {
          return {
            chainId: chain.chainId as SupportedChainId,
            network: getNetworkName(chain.chainId),
            eth: null,
            usdc: null,
            lowGas: true,
            error: 'Failed to fetch balances',
          };
        }
      }),
    );

    const anyLowGas = balances.some((b) => b.lowGas);

    return c.json({
      facilitatorAddress,
      status: anyLowGas ? 'low-gas' : 'ok',
      chains: balances,
    });
  });

  return route;
}
