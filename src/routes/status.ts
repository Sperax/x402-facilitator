import { Hono } from 'hono';
import { createPublicClient, http, formatUnits } from 'viem';
import { base, arbitrum, mainnet, baseSepolia, arbitrumSepolia } from 'viem/chains';

import type { FacilitatorConfig, SupportedChainId, Hex } from '../types/index.js';
import { getNetworkName } from '../config/chains.js';

const viemChains: Record<number, any> = {
  1: mainnet,
  8453: base,
  84532: baseSepolia,
  42161: arbitrum,
  421614: arbitrumSepolia,
};

export function createStatusRoute(config: FacilitatorConfig): Hono {
  const route = new Hono();

  route.get('/:txHash', async (c) => {
    const txHash = c.req.param('txHash') as Hex;

    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return c.json({ error: 'Invalid transaction hash. Must be 0x-prefixed 32-byte hex.' }, 400);
    }

    // Try each chain in parallel
    const results = await Promise.allSettled(
      config.chains.map(async (chain) => {
        const client = createPublicClient({
          chain: viemChains[chain.chainId],
          transport: http(chain.rpcUrl),
        });

        const receipt = await client.getTransactionReceipt({ hash: txHash });
        const tx = await client.getTransaction({ hash: txHash });

        return {
          chainId: chain.chainId as SupportedChainId,
          network: getNetworkName(chain.chainId),
          found: true,
          status: receipt.status === 'success' ? 'confirmed' : 'reverted',
          blockNumber: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
          from: receipt.from,
          to: receipt.to,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice
            ? formatUnits(receipt.effectiveGasPrice, 9) + ' gwei'
            : undefined,
          value: tx.value.toString(),
          explorerUrl: `${chain.blockExplorerUrl}/tx/${txHash}`,
        };
      }),
    );

    // Find the first chain where the tx was found
    for (const result of results) {
      if (result.status === 'fulfilled') {
        return c.json(result.value);
      }
    }

    return c.json({
      found: false,
      txHash,
      error: 'Transaction not found on any supported chain',
    }, 404);
  });

  return route;
}
