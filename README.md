# Solana SPL Airdrop Bot

Node.js + TypeScript bot that continuously redistributes a Solana SPL token from a bot wallet to eligible token holders every 60 minutes.

## What It Does

Every round (default: hourly), the bot:

1. Reads the bot wallet token balance.
2. Computes a pool equal to 20% of current balance.
3. Fetches token holders from Helius.
4. Excludes holders that sold the token in the last hour.
5. Calculates proportional allocations across eligible holders.
6. Sends SPL token transfers with retry + rate limiting.
7. Writes a round log to `logs/<timestamp>.json`.

## Safety Guarantees

- Distribution pool is always computed fresh as exactly 20% of current balance.
- If computed allocations exceed the pool, the round aborts.
- Very small rounds are skipped (`MIN_DISTRIBUTION_RAW`).
- Dust transfers are skipped (`MIN_ALLOCATION_RAW`).
- Round failures are caught so the bot continues next cycle.
- Last successful round time is persisted to disk, so restart does not trigger duplicate hourly rounds.
- `.env` is ignored by git.

## Project Structure

```txt
airdrop-bot/
  src/
    bot.ts
    holders.ts
    sellers.ts
    distribution.ts
    transfers.ts
    config.ts
    helius.ts
    types.ts
  logs/
  state/
  .env
  .env.example
  package.json
  README.md
```

## Prerequisites

- Node.js `>= 20.18.0`
- npm
- Solana wallet private key for the distributing bot
- Helius API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env
```

3. Set required values in `.env`:

```env
RPC_URL=
HELIUS_API_KEY=
PRIVATE_KEY=
TOKEN_MINT=G44cTCpQvULWRgEExYUuLjtLBmuTXUV21YyXwwTrpump
```

`PRIVATE_KEY` supports either:
- JSON array format (`[12,34,...]`), or
- base58 secret key string.

## Run

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

For the first validation round, keep `DRY_RUN=true`. After logs look correct, set `DRY_RUN=false`.
For a single proof run, also set `RUN_ONCE=true`.

## Log Format

Each round log (`logs/<timestamp>.json`) includes:

- `timestamp`
- `bot_balance`
- `distribution_pool`
- `eligible_holders_count`
- `excluded_sellers_count`
- `tx_hashes`
- optional `total_allocated`
- optional `attempted_transfers`
- optional `skipped_reason`
- optional `failed_transfers`

## Config Knobs

- `SELLER_TX_SCAN_MAX_PAGES` sets max transaction pages scanned per wallet during seller detection.
- `STATE_FILE_PATH` overrides persisted scheduler state file (default: `state/bot-state.json`).
- `DRY_RUN` toggles simulation mode (no on-chain transfers).
- `RUN_ONCE` executes one distribution round and exits.

## Operational Notes

- Wallet token funding is manual; this bot only redistributes.
- Seller detection uses recent Helius transactions and checks token outflows in the configured lookback window.
- Seller checks are paginated through Helius history for better coverage in active wallets.
- Transfer rate limiting defaults to ~5 tx/sec.

## Quick Proof

Run a single simulated round and exit:

```bash
RUN_ONCE=true DRY_RUN=true npm run dev
```

Run local verification:

```bash
npm run check
```
