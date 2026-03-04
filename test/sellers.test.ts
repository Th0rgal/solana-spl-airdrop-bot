import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { excludeRecentSellers, TxFetcher } from '../src/sellers';
import { Holder } from '../src/types';

const MINT = Keypair.generate().publicKey;

function txSell(wallet: string, timestamp: number, mint: PublicKey) {
  return {
    signature: `sig-${wallet}-${timestamp}`,
    timestamp,
    tokenTransfers: [
      {
        mint: mint.toBase58(),
        fromUserAccount: wallet,
        toUserAccount: Keypair.generate().publicKey.toBase58(),
        tokenAmount: '10'
      }
    ]
  };
}

test('excludeRecentSellers excludes only wallets with outflow in lookback window', async () => {
  const seller = Keypair.generate().publicKey.toBase58();
  const holder = Keypair.generate().publicKey.toBase58();
  const oldSeller = Keypair.generate().publicKey.toBase58();

  const holders: Holder[] = [
    { walletAddress: seller, balanceRaw: 100n },
    { walletAddress: holder, balanceRaw: 200n },
    { walletAddress: oldSeller, balanceRaw: 300n }
  ];

  const now = 10_000;
  const lookback = 3_600;

  const map = new Map<string, Array<{ signature: string; timestamp: number; tokenTransfers: Array<{ mint: string; fromUserAccount: string; toUserAccount: string; tokenAmount: string }> }>>([
    [seller, [txSell(seller, 9_900, MINT)]],
    [holder, [{ signature: 'sig-inbound', timestamp: 9_900, tokenTransfers: [{ mint: MINT.toBase58(), fromUserAccount: seller, toUserAccount: holder, tokenAmount: '10' }] }]],
    [oldSeller, [txSell(oldSeller, 1_000, MINT)]]
  ]);

  const fetchTransactions: TxFetcher = async (wallet) => map.get(wallet) ?? [];

  const result = await excludeRecentSellers(holders, MINT, lookback, 2, now, fetchTransactions);

  assert.equal(result.excludedSellersCount, 1);
  assert.deepEqual(
    result.eligibleHolders.map((entry) => entry.walletAddress).sort(),
    [holder, oldSeller].sort()
  );
});
