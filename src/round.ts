import { Allocation, Holder, RoundLog } from "./types";

export interface RoundDependencies {
  readBotTokenBalanceRaw: () => Promise<bigint>;
  fetchTokenHolders: () => Promise<Holder[]>;
  excludeRecentSellers: (
    holders: Holder[]
  ) => Promise<{ eligibleHolders: Holder[]; excludedSellersCount: number }>;
  calculateDistributionPool: (botBalanceRaw: bigint) => bigint;
  calculateAllocations: (
    eligibleHolders: Holder[],
    distributionPoolRaw: bigint,
    minAllocationRaw: bigint
  ) => Allocation[];
  executeTransfers: (
    allocations: Allocation[]
  ) => Promise<{ txHashes: string[]; failedTransfers: Array<{ wallet: string; amount: string; error: string }> }>;
  writeRoundLog: (roundLog: RoundLog) => Promise<void>;
  nowIso?: () => string;
}

export interface RunRoundParams {
  minDistributionRaw: bigint;
  minAllocationRaw: bigint;
  deps: RoundDependencies;
}

export async function runDistributionRound(params: RunRoundParams): Promise<RoundLog> {
  const { minDistributionRaw, minAllocationRaw, deps } = params;
  const timestamp = deps.nowIso ? deps.nowIso() : new Date().toISOString();

  const botBalanceRaw = await deps.readBotTokenBalanceRaw();
  const distributionPoolRaw = deps.calculateDistributionPool(botBalanceRaw);

  if (distributionPoolRaw < minDistributionRaw) {
    const roundLog: RoundLog = {
      timestamp,
      bot_balance: botBalanceRaw.toString(),
      distribution_pool: distributionPoolRaw.toString(),
      eligible_holders_count: 0,
      excluded_sellers_count: 0,
      tx_hashes: [],
      skipped_reason: "distribution pool below minimum threshold"
    };
    await deps.writeRoundLog(roundLog);
    return roundLog;
  }

  const holders = await deps.fetchTokenHolders();

  let eligibleHolders: Holder[];
  let excludedSellersCount: number;
  try {
    const sellerFilterResult = await deps.excludeRecentSellers(holders);
    eligibleHolders = sellerFilterResult.eligibleHolders;
    excludedSellersCount = sellerFilterResult.excludedSellersCount;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const roundLog: RoundLog = {
      timestamp,
      bot_balance: botBalanceRaw.toString(),
      distribution_pool: distributionPoolRaw.toString(),
      eligible_holders_count: 0,
      excluded_sellers_count: 0,
      tx_hashes: [],
      skipped_reason: `seller index unavailable: ${message}`
    };
    await deps.writeRoundLog(roundLog);
    return roundLog;
  }

  const allocations = deps.calculateAllocations(eligibleHolders, distributionPoolRaw, minAllocationRaw);

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
    await deps.writeRoundLog(roundLog);
    return roundLog;
  }

  const totalAllocated = allocations.reduce((sum, allocation) => sum + allocation.amountRaw, 0n);
  if (totalAllocated > distributionPoolRaw) {
    throw new Error("Safety violation: total allocation exceeds 20% distribution pool");
  }

  const { txHashes, failedTransfers } = await deps.executeTransfers(allocations);
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
  await deps.writeRoundLog(roundLog);
  return roundLog;
}
