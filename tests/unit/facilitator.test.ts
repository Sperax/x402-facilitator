import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';

import type { PaymentRequirements } from '../../src/types/index.js';
import { createTestPayment } from '../fixtures/payments.js';

const mockVerifyTypedData = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const mockReadContract = vi.fn<(args: { functionName: string }) => Promise<unknown>>();
const mockWriteContract = vi.fn();
vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    verifyTypedData: (...args: unknown[]) => mockVerifyTypedData(...args),
    createPublicClient: () => ({ readContract: mockReadContract }),
    createWalletClient: () => ({ writeContract: mockWriteContract }),
  };
});

vi.mock('../../src/config/env.js', () => ({
  env: {
    FACILITATOR_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    BASE_RPC_URL: 'https://base.example.com',
    BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example.com',
    ARBITRUM_RPC_URL: 'https://arb.example.com',
    ARBITRUM_SEPOLIA_RPC_URL: 'https://arb-sepolia.example.com',
    ETHEREUM_RPC_URL: 'https://eth.example.com',
    PORT: 3402,
    HOST: '0.0.0.0',
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    TRUSTED_PROXY_HOPS: 1,
    CORS_ORIGINS: '*',
    LOG_LEVEL: 'error',
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/utils/metrics.js', () => ({
  metrics: {
    verifyRequests: { inc: vi.fn() },
    verifyLatency: { observe: vi.fn() },
    verifyErrors: { inc: vi.fn() },
    settleSuccess: { inc: vi.fn() },
    settleFailed: { inc: vi.fn() },
    settleRejected: { inc: vi.fn() },
    settleLatency: { observe: vi.fn() },
  },
}));

describe('Facilitator', () => {
  it('should export Facilitator class', async () => {
    const mod = await import('../../src/core/facilitator.js');
    expect(mod.Facilitator).toBeDefined();
    expect(typeof mod.Facilitator).toBe('function');
  });
});

describe('Facilitator.verify binds the payment to its requirements', () => {
  const payment = createTestPayment();
  const requirements: PaymentRequirements = {
    chainId: 8453,
    asset: payment.token,
    payTo: payment.authorization.to,
    maxAmountRequired: payment.authorization.value,
  };

  async function makeFacilitator() {
    const { Facilitator } = await import('../../src/core/facilitator.js');
    const { CHAIN_CONFIGS } = await import('../../src/config/chains.js');
    return new Facilitator({
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      chains: [{ ...CHAIN_CONFIGS.base, rpcUrl: 'https://base.example.com' }],
      port: 3402,
      host: '0.0.0.0',
      rateLimitMax: 100,
      rateLimitWindowMs: 60_000,
      corsOrigins: ['*'],
      logLevel: 'error',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyTypedData.mockResolvedValue(true);
    mockReadContract.mockImplementation(async ({ functionName }) =>
      functionName === 'authorizationState' ? false : 10_000_000n,
    );
  });

  it('accepts a payment that matches the requirements', async () => {
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, requirements);
    expect(result).toEqual({ valid: true, isValid: true, payer: payment.authorization.from });
  });

  it('rejects a payment to a different recipient', async () => {
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, {
      ...requirements,
      payTo: '0x000000000000000000000000000000000000dEaD' as Address,
    });
    expect(result.isValid).toBe(false);
    expect('invalidReason' in result && result.invalidReason).toMatch(/recipient/i);
  });

  it('rejects a payment below the required amount', async () => {
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, {
      ...requirements,
      maxAmountRequired: payment.authorization.value + 1n,
    });
    expect(result.isValid).toBe(false);
    expect('invalidReason' in result && result.invalidReason).toMatch(/amount/i);
  });

  it('rejects a payment in a different asset', async () => {
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, {
      ...requirements,
      asset: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' as Address,
    });
    expect(result.isValid).toBe(false);
    expect('invalidReason' in result && result.invalidReason).toMatch(/asset/i);
  });

  it('rejects when the authorization nonce is already used on-chain', async () => {
    mockReadContract.mockImplementation(async ({ functionName }) =>
      functionName === 'authorizationState' ? true : 10_000_000n,
    );
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, requirements);
    expect(result).toEqual({
      valid: false,
      isValid: false,
      invalidReason: 'Authorization nonce already used',
    });
  });

  it('rejects when the payer balance does not cover the value', async () => {
    mockReadContract.mockImplementation(async ({ functionName }) =>
      functionName === 'authorizationState' ? false : 1n,
    );
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, requirements);
    expect(result).toEqual({ valid: false, isValid: false, invalidReason: 'Insufficient token balance' });
  });

  it('fails closed with a generic reason when the RPC throws', async () => {
    mockReadContract.mockRejectedValue(new Error('rpc https://secret-key.example.com down'));
    const facilitator = await makeFacilitator();
    const result = await facilitator.verify(payment, requirements);
    expect(result).toEqual({ valid: false, isValid: false, invalidReason: 'Verification unavailable' });
  });

  it('does not submit a transaction when verification fails', async () => {
    const facilitator = await makeFacilitator();
    const result = await facilitator.settle(payment, { ...requirements, maxAmountRequired: 10n ** 12n });
    expect(result.success).toBe(false);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it('returns a generic settlement error when the transaction throws', async () => {
    mockWriteContract.mockRejectedValue(new Error('nonce too low: account 0xfacilitator'));
    const facilitator = await makeFacilitator();
    const result = await facilitator.settle(payment, requirements);
    expect(result).toEqual({ success: false, errorReason: 'Settlement failed' });
  });
});
