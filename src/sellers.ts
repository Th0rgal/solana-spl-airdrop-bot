import { PublicKey } from "@solana/web3.js";
import { Holder } from "./types";

interface TokenTransfer {
  mint?: string;
  fromUserAccount?: string;
  toUserAccount?: string;
  tokenAmount?: string | number;
}

interface TxRecord {
  signature?: string;
  timestamp?: number;
  tokenTransfers?: TokenTransfer[];
}

export type TxFetcher = (wallet: string, before?: string) => Promise<TxRecord[]>;

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
  minTimestamp: number,
  maxPages: number,
  fetchTransactions: TxFetcher
): Promise<boolean> {
  let before: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const transactions = await fetchTransactions(wallet, before);

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return false;
    }

    let foundTxInWindow = false;
    for (const tx of transactions) {
      const txTimestamp = tx.timestamp ?? 0;
      if (txTimestamp < minTimestamp) {
        continue;
      }

      foundTxInWindow = true;
      const transfers = tx.tokenTransfers ?? [];
      if (transfers.some((transfer) => transferIsSell(transfer, wallet, tokenMint))) {
        return true;
      }
    }

    if (!foundTxInWindow) {
      return false;
    }

    const lastSignature = transactions[transactions.length - 1]?.signature;
    if (!lastSignature) {
      return false;
    }
    before = lastSignature;
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
  maxPages: number,
  nowUnixSeconds = Math.floor(Date.now() / 1000),
  fetchTransactions?: TxFetcher
): Promise<{ eligibleHolders: Holder[]; excludedSellersCount: number }> {
  const minTimestamp = nowUnixSeconds - lookbackSeconds;
  const mint = tokenMint.toBase58();
  const resolvedFetcher: TxFetcher =
    fetchTransactions ??
    (async (wallet, before) => {
      const { heliusGet } = await import("./helius");
      return heliusGet<TxRecord[]>(`/addresses/${wallet}/transactions`, { limit: 100, before });
    });

  const soldFlags = await runConcurrently(holders, 8, async (holder) => {
    try {
      return await hasSoldInWindow(holder.walletAddress, mint, minTimestamp, maxPages, resolvedFetcher);
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
