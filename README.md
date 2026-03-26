# @sperax/x402-facilitator

x402 payment facilitator — verifies and settles EIP-3009 USDC micropayments on Base, Arbitrum, and Ethereum.

## Quick Start

```bash
pnpm install
cp .env.example .env
# Edit .env with your private key and RPC URLs
pnpm dev
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm start` | Start production server |
| `pnpm build` | Build for production |
| `pnpm test` | Run tests |
| `pnpm typecheck` | Type-check without emitting |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/verify` | Verify an EIP-3009 payment signature |
| `POST` | `/settle` | Settle a verified payment on-chain |
| `GET` | `/health` | Health check |
| `GET` | `/info` | Supported chains and tokens |

## License

MIT
