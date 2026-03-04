import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Holder } from "../src/types";

const MINT = Keypair.generate().publicKey;
const TEST_STATE = path.resolve(process.cwd(), "state/seller-index.test.json");

function txSell(wallet: string, timestamp: number, mint: PublicKey, signature: string) {
  return {
    signature,
    timestamp,
    tokenTransfers: [
      {
        mint: mint.toBase58(),
        fromUserAccount: wallet,
        toUserAccount: Keypair.generate().publicKey.toBase58(),
        tokenAmount: "10"
      }
    ]
  };
}

async function cleanup(): Promise<void> {
  await fs.rm(TEST_STATE, { force: true });
}

function setTestEnv(): void {
  process.env.RPC_URL = "https://example-rpc.invalid";
  process.env.HELIUS_API_KEY = "test-helius-key";
  process.env.TOKEN_MINT = MINT.toBase58();
  process.env.LOOP_INTERVAL_MS = "3600000";
  process.env.RATE_LIMIT_PER_SECOND = "5";
  process.env.MAX_TRANSFER_RETRIES = "3";
  process.env.MIN_DISTRIBUTION_RAW = "1";
  process.env.MIN_ALLOCATION_RAW = "1";
  process.env.SELLER_LOOKBACK_SECONDS = "3600";
  process.env.SELLER_MINT_TX_SCAN_MAX_PAGES = "20";
  process.env.SELLER_INDEX_MAX_STALENESS_SECONDS = "7200";
}

test("excludeRecentSellers uses persisted seller index and excludes only recent sellers", async () => {
  await cleanup();
  const keypair = Keypair.generate();
  setTestEnv();
  process.env.PRIVATE_KEY = JSON.stringify(Array.from(keypair.secretKey));
  const { excludeRecentSellers } = await import("../src/sellers");

  try {
    const seller = Keypair.generate().publicKey.toBase58();
    const holder = Keypair.generate().publicKey.toBase58();
    const oldSeller = Keypair.generate().publicKey.toBase58();
    const holders: Holder[] = [
      { walletAddress: seller, balanceRaw: 100n },
      { walletAddress: holder, balanceRaw: 200n },
      { walletAddress: oldSeller, balanceRaw: 300n }
    ];

    let callCount = 0;
    const fetchTransactions = async (_mint: string, before?: string) => {
      callCount += 1;
      if (callCount === 1 && !before) {
        return [
          txSell(seller, 9_900, MINT, "sig-new"),
          txSell(oldSeller, 1_000, MINT, "sig-old")
        ];
      }
      return [];
    };

    const first = await excludeRecentSellers(holders, MINT, 3_600, 2, 10_000, fetchTransactions, {
      stateFilePath: TEST_STATE,
      maxStalenessSeconds: 7_200
    });
    assert.equal(first.excludedSellersCount, 1);
    assert.deepEqual(
      first.eligibleHolders.map((entry) => entry.walletAddress).sort(),
      [holder, oldSeller].sort()
    );
    assert.equal(callCount, 2);

    const second = await excludeRecentSellers(holders, MINT, 3_600, 2, 10_100, async () => [], {
      stateFilePath: TEST_STATE,
      maxStalenessSeconds: 7_200
    });
    assert.equal(second.excludedSellersCount, 1);
    assert.deepEqual(
      second.eligibleHolders.map((entry) => entry.walletAddress).sort(),
      [holder, oldSeller].sort()
    );
  } finally {
    await cleanup();
  }
});

test("excludeRecentSellers fails closed when seller index is stale and sync fails", async () => {
  await cleanup();
  const keypair = Keypair.generate();
  setTestEnv();
  process.env.PRIVATE_KEY = JSON.stringify(Array.from(keypair.secretKey));
  const { excludeRecentSellers, SellerIndexStaleError } = await import("../src/sellers");

  try {
    await fs.mkdir(path.dirname(TEST_STATE), { recursive: true });
    await fs.writeFile(
      TEST_STATE,
      JSON.stringify({
        cursorSignature: "cursor",
        lastSyncedAtUnix: 1000,
        sellerLastSoldAt: {}
      }),
      "utf8"
    );

    const holders: Holder[] = [{ walletAddress: Keypair.generate().publicKey.toBase58(), balanceRaw: 100n }];
    await assert.rejects(
      () => {
        return excludeRecentSellers(holders, MINT, 3_600, 1, 10_000, async () => {
          throw new Error("429 Too Many Requests");
        }, {
          stateFilePath: TEST_STATE,
          maxStalenessSeconds: 60
        });
      },
      SellerIndexStaleError
    );
  } finally {
    await cleanup();
  }
});
