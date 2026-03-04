# Solana SPL Airdrop Bot

Automates hourly redistribution of an SPL token balance from a bot wallet to eligible token holders.

## Brainstorm / Implementation Plan

1. Build a continuous scheduler (`while(true)` with 60-minute sleep) in `src/bot.ts`.
2. Read bot token balance, compute `distributionPool = 20%` each round, and skip tiny rounds.
3. Use Helius token-holders endpoint to fetch holders and exclude bot wallet + zero balances.
4. Use Helius address transaction history to detect wallets that sold in the last 60 minutes.
5. Distribute proportionally among eligible holders and skip dust allocations.
6. Send SPL transfers with rate limiting (~5 tx/sec), retries, and tx signature logging.
7. Persist each round log to `logs/<timestamp>.json` for restart-safe auditability.

## Status

Scaffold in progress.
