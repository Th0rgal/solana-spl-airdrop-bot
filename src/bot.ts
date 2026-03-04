import { promises as fs } from "fs";
import path from "path";
import { Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { config } from "./config";
import { fetchTokenHolders } from "./holders";
import { excludeRecentSellers } from "./sellers";
import { calculateAllocations, calculateDistributionPool } from "./distribution";
import { executeTransfers } from "./transfers";
import { RoundLog } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBotTokenBalanceRaw(connection: Connection): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(config.tokenMint, config.botKeypair.publicKey);
  const accountInfo = await connection.getTokenAccountBalance(ata).catch(() => null);
  if (!accountInfo) {
    return 0n;
  }

  return BigInt(accountInfo.value.amount);
}

async function writeRoundLog(roundLog: RoundLog): Promise<void> {
  const logsDir = path.resolve(process.cwd(), "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const safeTimestamp = roundLog.timestamp.replace(/[:.]/g, "-");
  const logPath = path.join(logsDir, `${safeTimestamp}.json`);
  await fs.writeFile(logPath, `${JSON.stringify(roundLog, null, 2)}\n`, "utf8");
}

async function runDistributionRound(connection: Connection, decimals: number): Promise<void> {
  const timestamp = new Date().toISOString();

  const botBalanceRaw = await readBotTokenBalanceRaw(connection);
  const distributionPoolRaw = calculateDistributionPool(botBalanceRaw);

  if (distributionPoolRaw < config.minDistributionRaw) {
    const roundLog: RoundLog = {
      timestamp,
      bot_balance: botBalanceRaw.toString(),
      distribution_pool: distributionPoolRaw.toString(),
      eligible_holders_count: 0,
      excluded_sellers_count: 0,
      tx_hashes: [],
      skipped_reason: "distribution pool below minimum threshold"
    };
    await writeRoundLog(roundLog);
    console.log(`[${timestamp}] Round skipped: low distribution pool (${distributionPoolRaw.toString()})`);
    return;
  }

  const holders = await fetchTokenHolders(config.tokenMint, config.botKeypair.publicKey, decimals);
  const { eligibleHolders, excludedSellersCount } = await excludeRecentSellers(
    holders,
    config.tokenMint,
    config.sellerLookbackSeconds,
    config.sellerTxScanMaxPages
  );

  const allocations = calculateAllocations(
    eligibleHolders,
    distributionPoolRaw,
    config.minAllocationRaw
  );

  if (allocations.length === 0) {
    const roundLog: RoundLog = {
      timestamp,
      bot_balance: botBalanceRaw.toString(),
      distribution_pool: distributionPoolRaw.toString(),
      eligible_holders_count: eligibleHolders.length,
      excluded_sellers_count: excludedSellersCount,
      tx_hashes: [],
      skipped_reason: "no eligible allocations after filtering"
    };
    await writeRoundLog(roundLog);
    console.log(`[${timestamp}] Round skipped: no allocations`);
    return;
  }

  const totalAllocated = allocations.reduce((sum, allocation) => sum + allocation.amountRaw, 0n);
  if (totalAllocated > distributionPoolRaw) {
    throw new Error("Safety violation: total allocation exceeds 20% distribution pool");
  }

  const { txHashes, failedTransfers } = await executeTransfers(
    connection,
    config.botKeypair,
    config.tokenMint,
    allocations,
    config.rateLimitPerSecond,
    config.maxTransferRetries,
    config.dryRun
  );

  const roundLog: RoundLog = {
    timestamp,
    bot_balance: botBalanceRaw.toString(),
    distribution_pool: distributionPoolRaw.toString(),
    total_allocated: totalAllocated.toString(),
    eligible_holders_count: eligibleHolders.length,
    excluded_sellers_count: excludedSellersCount,
    attempted_transfers: allocations.length,
    tx_hashes: txHashes,
    failed_transfers: failedTransfers
  };

  await writeRoundLog(roundLog);
  console.log(
    `[${timestamp}] Round complete: ${txHashes.length} successful tx, ${failedTransfers.length} failed`
  );
}

async function main(): Promise<void> {
  const connection = new Connection(config.rpcUrl, "confirmed");
  const mintInfo = await getMint(connection, config.tokenMint);
  const decimals = mintInfo.decimals;

  console.log(`Bot wallet: ${config.botKeypair.publicKey.toBase58()}`);
  console.log(`Token mint: ${config.tokenMint.toBase58()}`);
  console.log(`Token decimals: ${decimals}`);
  console.log(`Dry run mode: ${config.dryRun}`);

  while (true) {
    try {
      await runDistributionRound(connection, decimals);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`Distribution round failed: ${message}`);
    }

    console.log(`Sleeping for ${config.loopIntervalMs} ms`);
    await sleep(config.loopIntervalMs);
  }
}

void main();
