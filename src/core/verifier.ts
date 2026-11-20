import { verifyTypedData } from 'viem';

import type { VerifyResult, X402Payment, PaymentRequirements } from '../types/index.js';
import { getChainConfig } from '../config/chains.js';
import { getTokenConfig, getTokenDomain } from '../config/tokens.js';
import { logger } from '../utils/logger.js';

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * Off-chain payment verifier. Validates a payment against its requirements
 * without touching an RPC; the Facilitator adds the on-chain nonce and balance checks.
 */
export class PaymentVerifier {
  /**
   * Verify a payment against its requirements.
   *
   * Checks: chain match, asset match, recipient match, amount, timing,
   * requirements expiry, supported chain and token, and the EIP-712 signature.
   */
  async verify(payment: X402Payment, requirements: PaymentRequirements): Promise<VerifyResult> {
    const { chainId, token, authorization, signature } = payment;

    if (chainId !== requirements.chainId) {
      return { valid: false, reason: 'Chain ID mismatch' };
    }

    if (token.toLowerCase() !== requirements.asset.toLowerCase()) {
      return { valid: false, reason: 'Asset mismatch' };
    }

    if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { valid: false, reason: 'Recipient mismatch' };
    }

    if (authorization.value < requirements.maxAmountRequired) {
      return { valid: false, reason: 'Insufficient payment amount' };
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (authorization.validAfter > now) {
      return { valid: false, reason: 'Authorization not yet valid' };
    }
    if (authorization.validBefore <= now) {
      return { valid: false, reason: 'Authorization expired' };
    }

    if (requirements.expiry != null && requirements.expiry <= Number(now)) {
      return { valid: false, reason: 'Payment requirement expired' };
    }

    if (authorization.value <= 0n) {
      return { valid: false, reason: 'Value must be positive' };
    }

    try {
      getChainConfig(chainId);
    } catch {
      return { valid: false, reason: `Unsupported chain: ${chainId}` };
    }

    if (!getTokenConfig(chainId, token)) {
      return { valid: false, reason: `No EIP-712 domain for token ${token} on chain ${chainId}` };
    }

    try {
      const valid = await verifyTypedData({
        address: authorization.from,
        domain: getTokenDomain(token, chainId),
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: authorization.nonce,
        },
        signature,
      });

      if (!valid) {
        return { valid: false, reason: 'Invalid signature — signer does not match from address' };
      }

      logger.info(`Payment verified: ${authorization.from} → ${authorization.to} (${authorization.value} on chain ${chainId})`);
      return { valid: true, signer: authorization.from };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Signature verification threw',
      );
      return { valid: false, reason: 'Malformed signature' };
    }
  }
}
