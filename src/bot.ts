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
import { computeNextDelayMs, loadState, saveState } from "./state";
import { runDistributionRound } from "./round";

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

async function runDistributionRoundLive(connection: Connection, decimals: number): Promise<void> {
  const timestamp = new Date().toISOString();
  const roundLog: RoundLog = await runDistributionRound({
    minDistributionRaw: config.minDistributionRaw,
    minAllocationRaw: config.minAllocationRaw,
    deps: {
      nowIso: () => timestamp,
      readBotTokenBalanceRaw: async () => readBotTokenBalanceRaw(connection),
      fetchTokenHolders: async () =>
        fetchTokenHolders(config.tokenMint, config.botKeypair.publicKey, decimals),
      excludeRecentSellers: async (holders) =>
        excludeRecentSellers(
          holders,
          config.tokenMint,
          config.sellerLookbackSeconds,
          config.sellerMintTxScanMaxPages
        ),
      calculateDistributionPool,
      calculateAllocations,
      executeTransfers: async (allocations) =>
        executeTransfers(
          connection,
          config.botKeypair,
          config.tokenMint,
          allocations,
          config.rateLimitPerSecond,
          config.maxTransferRetries,
          config.dryRun
        ),
      writeRoundLog
    }
  });

  if (roundLog.skipped_reason) {
    console.log(`[${timestamp}] Round skipped: ${roundLog.skipped_reason}`);
    return;
  }

  const failedCount = roundLog.failed_transfers?.length ?? 0;
  console.log(`[${timestamp}] Round complete: ${roundLog.tx_hashes.length} successful tx, ${failedCount} failed`);
}

async function main(): Promise<void> {
  const connection = new Connection(config.rpcUrl, "confirmed");
  const mintInfo = await getMint(connection, config.tokenMint);
  const decimals = mintInfo.decimals;

  console.log(`Bot wallet: ${config.botKeypair.publicKey.toBase58()}`);
  console.log(`Token mint: ${config.tokenMint.toBase58()}`);
  console.log(`Token decimals: ${decimals}`);
  console.log(`Dry run mode: ${config.dryRun}`);
  console.log(`State file: ${config.stateFilePath}`);

  while (true) {
    if (!config.runOnce) {
      const state = await loadState(config.stateFilePath);
      const delayMs = computeNextDelayMs(
        state.lastRoundAttemptedAtMs,
        state.lastRoundCompletedAtMs,
        config.loopIntervalMs,
        Date.now()
      );
      if (delayMs > 0) {
        console.log(`Sleeping for ${delayMs} ms before next eligible round`);
        await sleep(delayMs);
      }
    }

    if (!config.runOnce) {
      await saveState(config.stateFilePath, { lastRoundAttemptedAtMs: Date.now() });
    }

    let roundSucceeded = false;
    try {
      await runDistributionRoundLive(connection, decimals);
      roundSucceeded = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`Distribution round failed: ${message}`);
    }

    if (roundSucceeded && !config.runOnce) {
      const state = await loadState(config.stateFilePath);
      await saveState(config.stateFilePath, {
        ...state,
        lastRoundCompletedAtMs: Date.now()
      });
    }

    if (config.runOnce) {
      console.log("RUN_ONCE=true, exiting after one round");
      break;
    }

    await sleep(250);
  }
}

void main();
