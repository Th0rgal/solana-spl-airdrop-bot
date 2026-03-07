import test from "node:test";
import assert from "node:assert/strict";
import { runDistributionRound } from "../src/round";
import { Allocation, Holder, RoundLog } from "../src/types";

function buildBaseDeps(overrides: Partial<Parameters<typeof runDistributionRound>[0]["deps"]> = {}) {
  const logs: RoundLog[] = [];
  const transferCalls: Allocation[][] = [];

  const deps: Parameters<typeof runDistributionRound>[0]["deps"] = {
    nowIso: () => "2026-03-04T00:00:00.000Z",
    readBotTokenBalanceRaw: async () => 1_000n,
    fetchTokenHolders: async () =>
      [
        { walletAddress: "A", balanceRaw: 400n },
        { walletAddress: "B", balanceRaw: 600n }
      ] as Holder[],
    excludeRecentSellers: async (holders) => ({ eligibleHolders: holders, excludedSellersCount: 0 }),
    calculateDistributionPool: (balance) => balance / 5n,
    calculateAllocations: (_eligible, pool) =>
      [
        { walletAddress: "A", amountRaw: pool / 2n },
        { walletAddress: "B", amountRaw: pool / 2n }
      ] as Allocation[],
    executeTransfers: async (allocations) => {
      transferCalls.push(allocations);
      return {
        txHashes: allocations.map((a) => `tx:${a.walletAddress}:${a.amountRaw.toString()}`),
        failedTransfers: []
      };
    },
    writeRoundLog: async (roundLog) => {
      logs.push(roundLog);
    },
    ...overrides
  };

  return { deps, logs, transferCalls };
}

test("runDistributionRound skips when distribution pool is below minimum", async () => {
  const { deps, logs, transferCalls } = buildBaseDeps({
    readBotTokenBalanceRaw: async () => 10n
  });

  await runDistributionRound({
    minDistributionRaw: 3n,
    minAllocationRaw: 1n,
    deps
  });

  assert.equal(transferCalls.length, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.distribution_pool, "2");
  assert.equal(logs[0]?.skipped_reason, "distribution pool below minimum threshold");
});

test("runDistributionRound skips when no allocations remain after filtering", async () => {
  const { deps, logs, transferCalls } = buildBaseDeps({
    excludeRecentSellers: async () => ({ eligibleHolders: [], excludedSellersCount: 2 }),
    calculateAllocations: () => []
  });

  await runDistributionRound({
    minDistributionRaw: 1n,
    minAllocationRaw: 1n,
    deps
  });

  assert.equal(transferCalls.length, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.excluded_sellers_count, 2);
  assert.equal(logs[0]?.skipped_reason, "no eligible allocations after filtering");
});

test("runDistributionRound writes full success log and executes transfers", async () => {
  const { deps, logs, transferCalls } = buildBaseDeps({
    excludeRecentSellers: async () => ({
      eligibleHolders: [{ walletAddress: "B", balanceRaw: 600n }],
      excludedSellersCount: 1
    }),
    calculateAllocations: () => [{ walletAddress: "B", amountRaw: 200n }]
  });

  await runDistributionRound({
    minDistributionRaw: 1n,
    minAllocationRaw: 1n,
    deps
  });

  assert.equal(transferCalls.length, 1);
  assert.equal(transferCalls[0]?.length, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.total_allocated, "200");
  assert.equal(logs[0]?.attempted_transfers, 1);
  assert.equal(logs[0]?.excluded_sellers_count, 1);
  assert.equal(logs[0]?.tx_hashes[0], "tx:B:200");
});

test("runDistributionRound throws on allocation overflow safety violation", async () => {
  const { deps } = buildBaseDeps({
    readBotTokenBalanceRaw: async () => 100n,
    calculateAllocations: () => [
      { walletAddress: "A", amountRaw: 11n },
      { walletAddress: "B", amountRaw: 10n }
    ]
  });

  await assert.rejects(
    () =>
      runDistributionRound({
        minDistributionRaw: 1n,
        minAllocationRaw: 1n,
        deps
      }),
    /Safety violation: total allocation exceeds 20% distribution pool/
  );
});

test("runDistributionRound skips when seller index check is unavailable", async () => {
  const { deps, logs, transferCalls } = buildBaseDeps({
    excludeRecentSellers: async () => {
      throw new Error("Seller index is stale");
    }
  });

  await runDistributionRound({
    minDistributionRaw: 1n,
    minAllocationRaw: 1n,
    deps
  });

  assert.equal(transferCalls.length, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.skipped_reason?.startsWith("seller index unavailable:"), true);
});
