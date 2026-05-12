# StakeWithFriends

StakeWithFriends is a mobile-first PWA for funded 1v1 USDC pacts on Arc Testnet. Users sign in, fund a vault, create or join a pact, upload result evidence, chat with the other participant, and resolve payouts on-chain.

Use Node.js `>=22 <24`. The API also needs Python 3 with the OCR dependencies in [apps/api/requirements.txt](apps/api/requirements.txt) when eFootball result detection is enabled.

## Stack

- React, Vite, Tailwind, and PWA caching
- Privy login plus wallet-extension and WalletConnect/Reown wallet support
- `viem` for Arc Testnet reads and writes
- Node API service for indexed reads, pact chat, uploads, OCR, and keeper jobs
- Supabase Postgres for app data and indexed read models
- Supabase Storage S3-compatible uploads for evidence files
- `efootball-ocr` with optional Ollama or OpenAI vision fallback
- Hardhat contract workspace

## Project Layout

```text
stakewithfriends
├── apps
│   ├── api
│   │   ├── src
│   │   ├── test
│   │   ├── requirements.txt
│   │   └── .env.example
│   └── web
│       ├── public
│       ├── src
│       └── .env.example
├── contracts
│   ├── contracts
│   ├── scripts
│   ├── test
│   ├── hardhat.config.js
│   └── .env.example
├── vercel.json
├── package.json
└── package-lock.json
```

`MockStablecoin.sol` is kept for local contract tests. Testnet deployments should use the Arc Testnet USDC ERC-20 interface address.

## Quick Start

1. Install JavaScript dependencies.

```bash
npm install
```

2. Install Python OCR dependencies.

```bash
python3 -m venv apps/api/.venv
apps/api/.venv/bin/python -m pip install -r apps/api/requirements.txt
```

3. Copy env files.

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp contracts/.env.example contracts/.env
```

4. Fill in Arc contract addresses, Supabase, Privy, and storage settings.

5. Run the API and web app in two terminals.

```bash
npm run dev:api
npm run dev:web
```

The web app runs on `http://127.0.0.1:5173` by default. The API runs on `http://127.0.0.1:8787`.

## Common Commands

```bash
npm run dev:web
npm run dev:api
npm run api:indexer
npm run api:indexer:once
npm run build:web
npm run test:web
npm run test:api
npm run contracts:compile
npm run contracts:test
npm run contracts:deploy
npm run contracts:deploy:username-registry
```

## Environment

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
VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
VITE_PRIVY_APP_ID=your_privy_app_id
ARC_RPC_UPSTREAM_URL=https://rpc.quicknode.testnet.arc.network
VITE_API_UPSTREAM_URL=http://127.0.0.1:8787
VITE_API_BASE_URL=
CATBOX_UPLOAD_UPSTREAM_URL=https://catbox.moe
```

`VITE_RPC_URL=/rpc/arc` keeps browser chain reads same-origin. `VITE_API_UPSTREAM_URL` is only used by the local Vite proxy. Leave `VITE_API_BASE_URL` empty when using the same-origin `/api` Vercel rewrite; set it to a full API URL only if you intentionally want the browser to call the API host directly.

### `apps/api/.env`

```env
API_HOST=127.0.0.1
API_PORT=8787
ALLOWED_ORIGIN=*
DATABASE_URL=postgresql://postgres.your-project-ref:your-password@aws-0-region.pooler.supabase.com:6543/postgres
ARC_RPC_URL=https://rpc.quicknode.testnet.arc.network
CHAIN_ID=5042002
EMBED_INDEXER=true
CORE_SYNC_MODE=state-snapshot
USERNAME_SYNC_MODE=state-snapshot
PACT_INDEX_START_BLOCK=0
USERNAME_INDEX_START_BLOCK=0
SYNC_BATCH_SIZE=100
SYNC_MAX_BATCHES_PER_RUN=25
SYNC_POLL_INTERVAL_MS=15000
HEALTH_SYNC_LAG_BLOCKS=5000
AUTONOMOUS_KEEPER_ENABLED=false
AUTONOMOUS_KEEPER_PRIVATE_KEY=
AUTONOMOUS_KEEPER_POLL_INTERVAL_MS=15000
AUTONOMOUS_KEEPER_BATCH_SIZE=25
SESSION_TTL_HOURS=168
NONCE_TTL_MINUTES=10
SESSION_COOKIE_SECURE=false
MAX_JSON_BODY_BYTES=8388608
MAX_EVIDENCE_IMAGE_BYTES=1048576
MAX_EVIDENCE_VIDEO_BYTES=10485760
STORAGE_MODE=supabase-s3
STORAGE_S3_ENDPOINT=https://your-project-ref.supabase.co/storage/v1/s3
STORAGE_BUCKET=evidence
STORAGE_REGION=eu-west-1
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_PUBLIC_BASE_URL=https://your-project-ref.supabase.co/storage/v1/object/public
STORAGE_AUTO_CREATE_BUCKET=true
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
FFMPEG_PATH=ffmpeg
AI_ANALYSIS_PROVIDER=ollama
EFOOTBALL_OCR_CONFIDENCE_THRESHOLD=0.6
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_VISION_MODEL=llava
OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-4.1-mini
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=
STATE_RECONCILE_CONCURRENCY=4
STABLECOIN_ADDRESS=0x3600000000000000000000000000000000000000
PROTOCOL_CONTROL_ADDRESS=0xYourProtocolControlAddress
PACT_VAULT_ADDRESS=0xYourPactVaultAddress
PACT_MANAGER_ADDRESS=0xYourPactManagerAddress
SUBMISSION_MANAGER_ADDRESS=0xYourSubmissionManagerAddress
PACT_RESOLUTION_MANAGER_ADDRESS=0xYourPactResolutionManagerAddress
USERNAME_REGISTRY_ADDRESS=0xYourUsernameRegistryAddress
```

The API requires `DATABASE_URL`; local SQLite is no longer used. Keep Supabase service role keys, storage secrets, Privy secrets, and keeper private keys in local env files or deployment secret stores only.

### `contracts/.env`

```env
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
PACT_ADMIN_ADDRESS=0xYourAdminWallet
PACT_STABLECOIN_ADDRESS=0x3600000000000000000000000000000000000000
PACT_MIN_STAKE_UNITS=1000000
PACT_FEE_RECIPIENT=0xYourFeeRecipient
PACT_FEE_BPS=0
```

Pass deployer keys only at runtime:

```bash
PRIVATE_KEY=your-deployer-private-key npm run contracts:deploy
PRIVATE_KEY=your-deployer-private-key npm run contracts:deploy:username-registry
```

## Deployment Notes

- Deploy the API separately from the static web app, for example on Render or another Node host.
- The API host must have `DATABASE_URL`, Arc RPC, contract addresses, Privy server credentials, Supabase Storage credentials, and Python OCR dependencies available.
- On Vercel, deploy from the repository root. The root [vercel.json](vercel.json) runs `npm run build:web` and publishes `apps/web/dist`.
- Set Vercel `API_UPSTREAM_URL` to the API hostname only, without `https://` and without `/api`. Example: `stakewithfriends-api.onrender.com`.
- If Vercel returns `DNS_HOSTNAME_NOT_FOUND` for `/api/*`, `API_UPSTREAM_URL` is missing or malformed. Remove `https://` from the value, save it for Production, Preview, and Development as needed, then redeploy.
- Keep frontend private keys out of Vercel. The web app only needs public Vite env values.
- Keep `VITE_RPC_URL=/rpc/arc` so browser RPC reads use the same-domain Arc rewrite.
- Timed autonomous settlement needs the API keeper running with `AUTONOMOUS_KEEPER_ENABLED=true` and a funded keeper key supplied from secrets.
- If OCR confidence is low, eFootball analysis can fall back to Ollama or OpenAI depending on `AI_ANALYSIS_PROVIDER`.

## Evidence And Chat

- Pact chat is persisted through the API and Supabase Postgres.
- Posting chat uses the signed-in Privy identity when available and can fall back to a one-time wallet signature.
- Evidence uploads go through the API, are validated, compressed with FFmpeg, and stored through Supabase Storage.
- eFootball pacts require a final-result screenshot before result submission. The API reads common eFootball result layouts and maps the detected winner to the pact participants.
- Legacy Catbox links may still appear in indexed evidence history, but new managed uploads should use Supabase Storage.

## Pact Lifecycle

1. `Created`
   Creator creates the pact and their stake is reserved immediately.
2. `Active`
   Counterparty joins, locks matching stake, and starts the event timer.
3. `Declaration`
   When the event duration ends, the declaration window opens.
4. `Auto split`
   If neither side declares before the declaration window closes, the keeper settles the pact to a split.
5. `Lone declaration review`
   If only one side declares, the other side has the review period to agree, dispute, or submit their own result.
6. `Auto win for lone declaration`
   If the review period ends silently, either participant or the keeper can settle to the declaring winner.
7. `Matched declarations`
   If both sides declare the same winner, the pact can settle immediately.
8. `Dispute`
   Conflicting declarations or challenged lone results move to arbiter review.
9. `Withdraw`
   Resolved funds remain in vault balances until withdrawn.

## Core Contracts

- `ProtocolControl`: admin roles and pause control
- `PactVault`: deposits, reserved stake, payouts, fee snapshots, and splits
- `PactManager`: create, join, cancel, minimum stake, and pact state
- `SubmissionManager`: winner declarations
- `PactResolutionManager`: settlement, disputes, review periods, and arbiter resolution
- `UsernameRegistry`: wallet-to-username lookup

## Validation

Run the relevant checks before deployment:

```bash
npm run build:web
npm run test:web
npm run test:api
npm run contracts:test
```
