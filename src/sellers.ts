import { PublicKey } from "@solana/web3.js";
import { heliusGet } from "./helius";
import { Holder } from "./types";

interface TokenTransfer {
  mint?: string;
  fromUserAccount?: string;
  toUserAccount?: string;
  tokenAmount?: string | number;
}

interface TxRecord {
  timestamp?: number;
  tokenTransfers?: TokenTransfer[];
}

function amountToNumber(value: string | number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  return typeof value === "number" ? value : Number(value);
}

function transferIsSell(transfer: TokenTransfer, wallet: string, tokenMint: string): boolean {
  if (!transfer.mint || transfer.mint !== tokenMint) {
    return false;
  }

  if (transfer.fromUserAccount !== wallet) {
    return false;
  }

  if (transfer.toUserAccount === wallet) {
    return false;
  }

  return amountToNumber(transfer.tokenAmount) > 0;
}

async function hasSoldInWindow(
  wallet: string,
  tokenMint: string,
  minTimestamp: number
): Promise<boolean> {
  const transactions = await heliusGet<TxRecord[]>(`/addresses/${wallet}/transactions`, {
    limit: 100
  });

  if (!Array.isArray(transactions)) {
    return false;
  }

  for (const tx of transactions) {
    const txTimestamp = tx.timestamp ?? 0;
    if (txTimestamp < minTimestamp) {
      continue;
    }

    const transfers = tx.tokenTransfers ?? [];
    if (transfers.some((transfer) => transferIsSell(transfer, wallet, tokenMint))) {
      return true;
    }
  }

  return false;
}

async function runConcurrently<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function runner(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

export async function excludeRecentSellers(
  holders: Holder[],
  tokenMint: PublicKey,
  lookbackSeconds: number,
  nowUnixSeconds = Math.floor(Date.now() / 1000)
): Promise<{ eligibleHolders: Holder[]; excludedSellersCount: number }> {
  const minTimestamp = nowUnixSeconds - lookbackSeconds;
  const mint = tokenMint.toBase58();

  const soldFlags = await runConcurrently(holders, 8, async (holder) => {
    try {
      return await hasSoldInWindow(holder.walletAddress, mint, minTimestamp);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to inspect seller activity for ${holder.walletAddress}: ${message}`);
      return false;
    }
  });

  const eligibleHolders: Holder[] = [];
  let excludedSellersCount = 0;

  holders.forEach((holder, i) => {
    if (soldFlags[i]) {
      excludedSellersCount += 1;
    } else {
      eligibleHolders.push(holder);
    }
  });

  return { eligibleHolders, excludedSellersCount };
}
