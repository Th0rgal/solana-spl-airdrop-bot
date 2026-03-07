import { Allocation, Holder } from "./types";

export function calculateDistributionPool(balanceRaw: bigint): bigint {
  return (balanceRaw * 20n) / 100n;
}

export function calculateAllocations(
  holders: Holder[],
  distributionPoolRaw: bigint,
  minAllocationRaw: bigint
): Allocation[] {
  if (holders.length === 0 || distributionPoolRaw <= 0n) {
    return [];
  }

  const eligibleTotal = holders.reduce((sum, holder) => sum + holder.balanceRaw, 0n);
  if (eligibleTotal <= 0n) {
    return [];
  }

  const preliminary: Allocation[] = holders.map((holder) => ({
    walletAddress: holder.walletAddress,
    amountRaw: (distributionPoolRaw * holder.balanceRaw) / eligibleTotal
  }));

  const filtered = preliminary
    .filter((allocation) => allocation.amountRaw >= minAllocationRaw)
    .map((allocation) => ({ ...allocation }));

  return filtered;
}
