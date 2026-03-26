# @sperax/x402-facilitator

> Production x402 payment facilitator by [Sperax](https://sperax.io). Live at **[x402.sperax.io](https://x402.sperax.io)**

An [x402](https://github.com/coinbase/x402) payment facilitator that verifies and settles EIP-3009 USDC micropayments on Base, Arbitrum, and Ethereum.

Built with [Hono](https://hono.dev), [viem](https://viem.sh), and [Zod](https://zod.dev).

## Live Endpoints

| Endpoint | URL |
|---|---|
| Root | [x402.sperax.io](https://x402.sperax.io) |
| Health | [x402.sperax.io/health](https://x402.sperax.io/health) |
| Supported | [x402.sperax.io/supported](https://x402.sperax.io/supported) |
| Info | [x402.sperax.io/info](https://x402.sperax.io/info) |

**Facilitator Address**: [`0x40252CFDF8B20Ed757D61ff157719F33Ec332402`](https://basescan.org/address/0x40252CFDF8B20Ed757D61ff157719F33Ec332402)

## How It Works

The x402 protocol enables HTTP 402-based micropayments. This facilitator acts as the trusted intermediary that verifies payment signatures and settles them on-chain.

<p align="center">
  <img src="docs/x402-flow.svg" alt="x402 Payment Flow" width="800"/>
</p>

| Step | Action | Description |
|:---:|---|---|
| **1** | `GET /resource` | Client requests a paid resource |
| **2** | `402 Payment Required` | Server responds with payment requirements |
| **3** | EIP-712 signing | Client signs a `TransferWithAuthorization` ([EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)) message |
| **4** | `GET /resource + X-PAYMENT` | Client retries with signed payment header |
| **5** | `POST /settle` | Resource server sends payment to facilitator |
| **6** | `transferWithAuthorization()` | Facilitator verifies signature and settles on-chain |
| **7** | `tx receipt` | Blockchain confirms the USDC transfer |
| **8** | `{ success, txHash }` | Facilitator returns settlement proof |
| **9** | `200 OK + resource` | Resource server grants access |

## Supported Chains

| Chain | Chain ID | USDC Address | Status |
|---|---|---|---|
| Base | `8453` | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) | Active |
| Base Sepolia | `84532` | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/token/0x036CbD53842c5426634e7929541eC2318f3dCF7e) | Active |
| Arbitrum One | `42161` | [`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`](https://arbiscan.io/token/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) | Supported |
| Arbitrum Sepolia | `421614` | [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d) | Supported |
| Ethereum | `1` | [`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`](https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48) | Supported |

All chains use Circle's native USDC with EIP-3009 `transferWithAuthorization` support.

## Quick Start

```bash
git clone https://github.com/Sperax/x402-facilitator.git
cd x402-facilitator
pnpm install
cp .env.example .env
# Edit .env with your private key and RPC URLs
pnpm dev
```

### Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm start` | Start production server |
| `pnpm build` | Build for production |
| `pnpm test` | Run tests (28 unit tests) |
| `pnpm typecheck` | Type-check without emitting |

## API Reference

### `GET /`

Root endpoint. Returns facilitator name and available endpoints.

```bash
curl https://x402.sperax.io/
```

```json
{
  "name": "SperaxOS x402 Facilitator",
  "docs": "https://github.com/Sperax/x402-facilitator",
  "endpoints": ["/verify", "/settle", "/health", "/info", "/supported"]
}
```

### `POST /verify`

Verify an EIP-3009 payment signature without settling on-chain. Used by resource servers to check if a payment is valid before granting access.

```bash
curl -X POST https://x402.sperax.io/verify \
  -H "Content-Type: application/json" \
  -d '{
    "paymentPayload": {
      "x402Version": 1,
      "chainId": 8453,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "authorization": {
        "from": "0xSenderAddress",
        "to": "0xRecipientAddress",
        "value": "1000000",
        "validAfter": "0",
        "validBefore": "1735689600",
        "nonce": "0x..."
      },
      "signature": "0x..."
    },
    "paymentRequirements": {
      "chainId": 8453,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xRecipientAddress",
      "maxAmountRequired": "1000000"
    }
  }'
```

**200 OK**
```json
{ "isValid": true }
```

**400 Bad Request**
```json
{ "isValid": false, "error": "Insufficient authorization amount" }
```

### `POST /settle`

Verify and settle a payment on-chain by calling `transferWithAuthorization` on the USDC contract. This is the primary endpoint used by x402 resource servers.

```bash
curl -X POST https://x402.sperax.io/settle \
  -H "Content-Type: application/json" \
  -d '{
    "paymentPayload": { ... },
    "paymentRequirements": { ... }
  }'
```

**200 OK**
```json
{
  "success": true,
  "txHash": "0xabc123...",
  "transaction": "0xabc123...",
  "network": "base",
  "payer": "0xSenderAddress"
}
```

**402 Payment Required**
```json
{
  "success": false,
  "error": "Payment verification failed"
}
```

### `GET /health`

Per-chain RPC connectivity check. Returns live block numbers for each connected chain.

```bash
curl https://x402.sperax.io/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "chains": [
    { "chainId": 8453, "network": "base", "connected": true, "blockNumber": 43885069 },
    { "chainId": 84532, "network": "base-sepolia", "connected": true, "blockNumber": 39395599 }
  ]
}
```

### `GET /supported`

Returns payment kinds supported by this facilitator. Required by the x402 SDK for discovery.

```bash
curl https://x402.sperax.io/supported
```

```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "base",
      "extra": { "name": "USDC", "decimals": 6, "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
    }
  ]
}
```

### `GET /info`

Facilitator metadata: address, supported chains, tokens, and operator info.

```bash
curl https://x402.sperax.io/info
```

```json
{
  "name": "SperaxOS x402 Facilitator",
  "version": "1.0.0",
  "x402Version": 1,
  "facilitatorAddress": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
  "supportedChains": [
    {
      "chainId": 8453,
      "network": "base",
      "tokens": [{ "symbol": "USDC", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6 }]
    }
  ],
  "operator": { "name": "SperaxOS", "url": "https://chat.sperax.io" }
}
```

## Deployment

### Railway (recommended)

The repo includes `railway.json` for one-click deployment:

1. [Deploy from GitHub](https://railway.app/new) and select this repo
2. Set environment variables in the Railway dashboard
3. Add a custom domain (e.g., `x402.yourdomain.com`)
4. Railway handles SSL, health checks, and auto-deploys on push

### Docker

```bash
docker build -t x402-facilitator .
docker run -p 3402:3402 --env-file .env x402-facilitator
```

### Docker Compose

```bash
docker compose up -d
```

## Environment Variables

See [`.env.example`](.env.example) for all options.

### Required

| Variable | Description |
|---|---|
| `FACILITATOR_PRIVATE_KEY` | 32-byte hex private key (`0x...`). The wallet that submits settlement transactions. |
| `BASE_RPC_URL` | RPC endpoint for Base mainnet (enabled by default) |

### Optional — Additional Chains

| Variable | Description |
|---|---|
| `BASE_SEPOLIA_RPC_URL` | RPC endpoint for Base Sepolia testnet |
| `ARBITRUM_RPC_URL` | RPC endpoint for Arbitrum One |
| `ARBITRUM_SEPOLIA_RPC_URL` | RPC endpoint for Arbitrum Sepolia testnet |
| `ETHEREUM_RPC_URL` | RPC endpoint for Ethereum mainnet |

### Optional — Feature Flags

| Variable | Default | Description |
|---|---|---|
| `ENABLE_BASE` | `true` | Enable Base mainnet |
| `ENABLE_BASE_SEPOLIA` | `true` | Enable Base Sepolia |
| `ENABLE_ARBITRUM` | `false` | Enable Arbitrum One |
| `ENABLE_ARBITRUM_SEPOLIA` | `false` | Enable Arbitrum Sepolia |
| `ENABLE_ETHEREUM` | `false` | Enable Ethereum mainnet |

### Optional — Server Config

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3402` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

The facilitator wallet needs ETH on each enabled chain to pay gas for `transferWithAuthorization` calls. The wallet does not custody user funds.

## Security

- **Non-custodial**: The facilitator wallet only needs ETH for gas. It never holds user USDC. Payments flow directly from sender to recipient via `transferWithAuthorization`.
- **EIP-712 verification**: All payment signatures are cryptographically verified against the sender's address before settlement.
- **Nonce protection**: Each authorization nonce is checked on-chain before submission to prevent replay attacks. In-flight nonces are tracked in memory to prevent concurrent double-settlement.
- **Rate limiting**: Configurable per-IP rate limiting via middleware.
- **Input validation**: All request bodies are validated with Zod schemas before processing.
- **Secure headers**: HSTS, X-Frame-Options, CSP, and other security headers via Hono middleware.

## Architecture

```
src/
├── index.ts                     # Hono server entry point
├── server.ts                    # Server factory
├── core/
│   ├── facilitator.ts           # Orchestrates verify + settle flow
│   ├── verifier.ts              # EIP-712 signature + requirements validation
│   ├── settler.ts               # On-chain transferWithAuthorization
│   └── nonce-store.ts           # LRU nonce dedup cache
├── config/
│   ├── chains.ts                # Chain configs (Base, Arbitrum, Ethereum)
│   ├── tokens.ts                # Token registry + EIP-712 domains
│   └── env.ts                   # Zod-validated environment
├── routes/
│   ├── verify.ts                # POST /verify
│   ├── settle.ts                # POST /settle
│   ├── health.ts                # GET /health
│   ├── info.ts                  # GET /info
│   └── supported.ts             # GET /supported
├── middleware/
│   ├── cors.ts                  # CORS configuration
│   ├── rateLimit.ts             # Per-IP rate limiting
│   ├── validate.ts              # Request validation schemas
│   └── x402-resource-server.ts  # x402 resource server middleware
├── types/
│   └── index.ts                 # TypeScript interfaces
└── utils/
    ├── logger.ts                # Structured JSON logging (pino)
    ├── metrics.ts               # Prometheus-style counters
    ├── errors.ts                # Error classes
    └── hex.ts                   # Hex utilities
```

## About

Built by [Sperax](https://sperax.io) for the x402 ecosystem.

- **SperaxOS**: [chat.sperax.io](https://chat.sperax.io) — AI Agent Workspace
- **Sperax dApp**: [app.sperax.io](https://app.sperax.io)
- **x402 Protocol**: [github.com/coinbase/x402](https://github.com/coinbase/x402)

## License

MIT
