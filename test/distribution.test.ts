import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAllocations, calculateDistributionPool } from '../src/distribution';
import { Holder } from '../src/types';

test('calculateDistributionPool returns exactly 20 percent', () => {
  assert.equal(calculateDistributionPool(1000n), 200n);
  assert.equal(calculateDistributionPool(5n), 1n);
  assert.equal(calculateDistributionPool(0n), 0n);
});

test('calculateAllocations never exceeds pool', () => {
  const holders: Holder[] = [
    { walletAddress: 'A', balanceRaw: 30n },
    { walletAddress: 'B', balanceRaw: 70n }
  ];

  const allocations = calculateAllocations(holders, 101n, 1n);
  const total = allocations.reduce((sum, entry) => sum + entry.amountRaw, 0n);

  assert.equal(allocations.length, 2);
  assert.ok(total <= 101n);
});

test('calculateAllocations filters dust amounts', () => {
  const holders: Holder[] = [
    { walletAddress: 'A', balanceRaw: 1n },
    { walletAddress: 'B', balanceRaw: 999n }
  ];

  const allocations = calculateAllocations(holders, 100n, 2n);

  assert.equal(allocations.length, 1);
  assert.equal(allocations[0]?.walletAddress, 'B');
  assert.ok(allocations[0].amountRaw <= 100n);
});
