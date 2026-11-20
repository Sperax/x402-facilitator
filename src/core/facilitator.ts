import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, mainnet, arbitrum, arbitrumSepolia } from 'viem/chains';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { PublicClient, WalletClient } from 'viem';

import type {
  Address,
  FacilitatorConfig,
  SettleResponse,
  SupportedChainId,
  VerifyResponse,
  X402Payment,
  PaymentRequirements,
} from '../types/index.js';
import { ERC20_TRANSFER_WITH_AUTHORIZATION_ABI } from '../abi/erc20-permit.js';
import { PaymentVerifier } from './verifier.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

/**
 * Map SupportedChainId → viem chain object.
 */
function getViemChain(chainId: SupportedChainId) {
  switch (chainId) {
    case 1: return mainnet;
    case 8453: return base;
    case 84532: return baseSepolia;
    case 42161: return arbitrum;
    case 421614: return arbitrumSepolia;
    default: throw new Error(`Unknown chain: ${chainId}`);
  }
}

const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Decompose a 65-byte EIP-712 signature (0x-prefixed) into v, r, s.
 */
function decomposeSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const sig = signature.slice(2);
  if (sig.length !== 130) {
    throw new Error(`Invalid signature length: expected 130 hex chars, got ${sig.length}`);
  }
  const r = `0x${sig.slice(0, 64)}` as Hex;
  const s = `0x${sig.slice(64, 128)}` as Hex;
  let v = parseInt(sig.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

/**
 * Facilitator — orchestrates payment verification and on-chain settlement.
 */
export class Facilitator {
  private walletClients: Map<SupportedChainId, WalletClient> = new Map();
  private publicClients: Map<SupportedChainId, PublicClient> = new Map();
  private readonly address: Address;
  private inflightNonces: Set<string> = new Set();
  private readonly verifier = new PaymentVerifier();

  constructor(config: FacilitatorConfig) {
    const account = privateKeyToAccount(config.privateKey);
    this.address = account.address;

    for (const chain of config.chains) {
      const viemChain = getViemChain(chain.chainId);

      this.walletClients.set(
        chain.chainId,
        createWalletClient({ account, chain: viemChain, transport: http(chain.rpcUrl) }),
      );
      this.publicClients.set(
        chain.chainId,
        createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) }) as PublicClient,
      );
    }
  }

  getAddress(): Address {
    return this.address;
  }

  /**
   * Verify a payment against its requirements without settling.
   *
   * Runs the off-chain checks (recipient, asset, amount, timing, signature),
   * then confirms on-chain that the authorization nonce is unused and the
   * payer holds enough of the token. RPC failures reject the payment.
   */
  async verify(
    payment: X402Payment,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const start = Date.now();

    try {
      const result = await this.verifier.verify(payment, requirements);
      const onChainReason = result.valid ? await this.checkOnChain(payment) : undefined;
      const valid = result.valid && !onChainReason;

      metrics.verifyRequests.inc({ valid: String(valid) });
      metrics.verifyLatency.observe(Date.now() - start);

      if (!valid) {
        const reason = result.reason ?? onChainReason ?? 'Unknown';
        logger.info({ reason }, 'Payment verification failed');
        return { valid: false, isValid: false, invalidReason: reason };
      }

      return { valid: true, isValid: true, payer: payment.authorization.from };
    } catch (error: unknown) {
      metrics.verifyErrors.inc();
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Verification threw',
      );
      return { valid: false, isValid: false, invalidReason: 'Verification unavailable' };
    }
  }

  /**
   * On-chain checks: the EIP-3009 nonce must be unused and the payer's
   * balance must cover the authorized value. Returns a reason on failure.
   */
  private async checkOnChain(payment: X402Payment): Promise<string | undefined> {
    const publicClient = this.publicClients.get(payment.chainId);
    if (!publicClient) return `Unsupported chain: ${payment.chainId}`;

    const { from, nonce, value } = payment.authorization;
    const [nonceUsed, balance] = await Promise.all([
      publicClient.readContract({
        address: payment.token,
        abi: ERC20_TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: 'authorizationState',
        args: [from, nonce],
      }),
      publicClient.readContract({
        address: payment.token,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [from],
      }),
    ]);

    if (nonceUsed) return 'Authorization nonce already used';
    if (balance < value) return 'Insufficient token balance';
    return undefined;
  }

  /**
   * Verify and settle a payment on-chain.
   */
  async settle(
    payment: X402Payment,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const start = Date.now();
    const nonceKey = `${payment.chainId}:${payment.authorization.from}:${payment.authorization.nonce}`;

    if (this.inflightNonces.has(nonceKey)) {
      return { success: false, errorReason: 'Settlement already in progress for this nonce' };
    }

    this.inflightNonces.add(nonceKey);

    try {
      // Step 1: Verify
      const verification = await this.verify(payment, requirements);
      if (!verification.isValid) {
        metrics.settleRejected.inc();
        return {
          success: false,
          errorReason: `Verification failed: ${'invalidReason' in verification ? verification.invalidReason : 'Unknown'}`,
        };
      }

      // Step 2: Settle on-chain
      const walletClient = this.walletClients.get(payment.chainId);
      const publicClient = this.publicClients.get(payment.chainId);
      if (!walletClient || !publicClient) {
        return { success: false, errorReason: `Unsupported chain: ${payment.chainId}` };
      }

      const { v, r, s } = decomposeSignature(payment.signature);

      const txHash = await (walletClient as any).writeContract({
        address: payment.token,
        abi: ERC20_TRANSFER_WITH_AUTHORIZATION_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          payment.authorization.from,
          payment.authorization.to,
          payment.authorization.value,
          payment.authorization.validAfter,
          payment.authorization.validBefore,
          payment.authorization.nonce,
          v,
          r,
          s,
        ],
      }) as Hex;

      logger.info({ txHash, chainId: payment.chainId }, 'Settlement tx submitted');

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 60_000,
      });

      if (receipt.status === 'success') {
        metrics.settleSuccess.inc({ chainId: String(payment.chainId) });
        metrics.settleLatency.observe(Date.now() - start);
        return {
          success: true,
          txHash,
          transaction: txHash,
          network: this.getNetworkForChain(payment.chainId),
          payer: payment.authorization.from,
        };
      }

      metrics.settleFailed.inc({ chainId: String(payment.chainId) });
      return { success: false, errorReason: 'Transaction reverted on-chain' };
    } catch (error: unknown) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Settlement failed',
      );
      metrics.settleFailed.inc({ chainId: String(payment.chainId) });
      return { success: false, errorReason: 'Settlement failed' };
    } finally {
      this.inflightNonces.delete(nonceKey);
    }
  }

  private getNetworkForChain(chainId: SupportedChainId): string {
    const names: Record<SupportedChainId, string> = {
      1: 'ethereum',
      8453: 'base',
      84532: 'base-sepolia',
      42161: 'arbitrum',
      421614: 'arbitrum-sepolia',
    };
    return names[chainId] ?? 'unknown';
  }
}
