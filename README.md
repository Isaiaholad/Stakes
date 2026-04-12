# StakeWithFriends

StakeWithFriends is a mobile-first PWA for simple 1v1 USDC pacts on Arc Testnet. Users fund a vault, create or join a pact, declare a result, and resolve payouts on-chain.

Use Node.js 20 or 22 LTS for local development and CI.

## Stack

- React + Vite + Tailwind
- Wallet-native auth with injected wallets
- `viem` for Arc Testnet reads and writes
- Hardhat contract workspace
- On-chain username registry for `@username` invites
- Catbox uploads for dispute-proof links

## Project Layout

```text
stakewithfriends
├── apps
│   └── web
│       ├── public
│       ├── src
│       └── .env.example
├── contracts
│   ├── contracts
│   │   ├── MockStablecoin.sol
│   │   ├── UsernameRegistry.sol
│   │   └── pacts
│   ├── scripts
│   ├── test
│   ├── hardhat.config.js
│   └── .env.example
├── package.json
└── package-lock.json
```

`MockStablecoin.sol` is kept only for local contract tests. The deployment flow uses the Arc Testnet USDC ERC-20 interface address.

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Copy the env files.

```bash
cp apps/web/.env.example apps/web/.env
cp contracts/.env.example contracts/.env
cp apps/api/.env.example apps/api/.env
```

3. Add your Arc Testnet values and deployed addresses.

4. Run the app.

```bash
npm run dev:web
```

5. Run the local API if you want indexed reads, pact chat, and timed autonomous settlement.

```bash
npm run dev:api
```

## Contract Commands

Compile:

```bash
npm run contracts:compile
```

Test:

```bash
npm run contracts:test
```

Deploy the core contracts with an existing USDC address:

```bash
npm run contracts:deploy
```

Deploy the username registry:

```bash
npm run contracts:deploy:username-registry
```

## Required Environment Variables

### `apps/web/.env`

```env
VITE_CHAIN_ID=5042002
VITE_RPC_URL=/rpc/arc
VITE_STABLECOIN_ADDRESS=0x3600000000000000000000000000000000000000
VITE_PROTOCOL_CONTROL_ADDRESS=0xYourProtocolControlAddress
VITE_PACT_VAULT_ADDRESS=0xYourPactVaultAddress
VITE_PACT_MANAGER_ADDRESS=0xYourPactManagerAddress
VITE_SUBMISSION_MANAGER_ADDRESS=0xYourSubmissionManagerAddress
VITE_PACT_RESOLUTION_MANAGER_ADDRESS=0xYourPactResolutionManagerAddress
VITE_USERNAME_REGISTRY_ADDRESS=0xYourUsernameRegistryAddress
ARC_RPC_UPSTREAM_URL=https://rpc.testnet.arc.network
CATBOX_UPLOAD_UPSTREAM_URL=https://catbox.moe
```

### `apps/api/.env`

```env
API_HOST=127.0.0.1
API_PORT=8787
ARC_RPC_URL=https://rpc.testnet.arc.network
CHAIN_ID=5042002
EMBED_INDEXER=true
STABLECOIN_ADDRESS=0x3600000000000000000000000000000000000000
PROTOCOL_CONTROL_ADDRESS=0xYourProtocolControlAddress
PACT_VAULT_ADDRESS=0xYourPactVaultAddress
PACT_MANAGER_ADDRESS=0xYourPactManagerAddress
SUBMISSION_MANAGER_ADDRESS=0xYourSubmissionManagerAddress
PACT_RESOLUTION_MANAGER_ADDRESS=0xYourPactResolutionManagerAddress
USERNAME_REGISTRY_ADDRESS=0xYourUsernameRegistryAddress
AUTONOMOUS_KEEPER_ENABLED=false
AUTONOMOUS_KEEPER_PRIVATE_KEY=
AUTONOMOUS_KEEPER_POLL_INTERVAL_MS=15000
AUTONOMOUS_KEEPER_BATCH_SIZE=25
```

### `contracts/.env`

```env
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
PACT_ADMIN_ADDRESS=0xYourAdminWallet
PACT_STABLECOIN_ADDRESS=0x3600000000000000000000000000000000000000
```

Supply `PRIVATE_KEY` only at runtime from your terminal or CI secret store, not from a repo-local env file.

`AUTONOMOUS_KEEPER_PRIVATE_KEY` is only needed for the local API when you want unattended timed settlement. Keep it out of repo-local defaults and inject it at runtime or from your deployment secret store.

## Deployment Notes

- Deploy contracts to Arc Testnet first.
- Use the Arc Testnet USDC ERC-20 interface address in `PACT_STABLECOIN_ADDRESS`.
- Copy the deployed Arc contract addresses into `apps/web/.env` and `apps/web/.env.production`.
- Copy the same Arc contract addresses into `apps/api/.env` if you want indexed reads, chat, and autonomous settlement.
- Keep `VITE_RPC_URL=/rpc/arc` so browser RPC reads stay same-origin.
- `apps/web/vercel.json` already rewrites `/rpc/arc`, `/upload/catbox`, and `/api`.
- On Vercel, set `API_UPSTREAM_URL` to the full API host (no path), so `/api/*` is proxied to your backend.
- On Vercel, set the project root to `apps/web`, build with `npm run build`, and publish `dist`.
- The web app does not need a private key on Vercel.
- Timed autonomous settlement needs the API keeper running with `AUTONOMOUS_KEEPER_ENABLED=true` and a funded keeper key supplied at runtime.
- For contract deployment, pass the deployer key only at runtime, for example:

```bash
PRIVATE_KEY=your-deployer-private-key npm run contracts:deploy
PRIVATE_KEY=your-deployer-private-key npm run contracts:deploy:username-registry
```

- Do not put a deployer private key in Vercel for this frontend-only app.

## Pact Lifecycle

1. `Created`
   Creator creates the pact and their stake is reserved immediately.
2. `Active`
   Counterparty joins, locks matching stake, and starts the event timer.
3. `Declaration`
   When the event duration ends, the declaration window opens.
4. `Auto split`
   If neither side declares before the declaration window closes, the keeper settles the pact to a split.
5. `Auto win for lone declaration`
   If only one side declares, the other side has the declaration grace period to dispute. If they stay silent, the keeper settles to the declaring winner.
6. `Auto settle for matched declarations`
   If both sides declare the same winner, the second declaration transaction resolves the pact immediately.
7. `Dispute`
   If both sides declare different winners, the second declaration transaction opens dispute immediately. The silent side can also open dispute during the lone-declaration review period.
8. `Withdraw`
   Resolved funds remain in vault balances until withdrawn.

## Core Contracts

- `ProtocolControl`: admin roles and pause control
- `PactVault`: deposits, reserved stake, payouts, and splits
- `PactManager`: create, join, cancel, and pact state
- `SubmissionManager`: winner declarations
- `PactResolutionManager`: settlement and disputes
- `UsernameRegistry`: wallet-to-username lookup
