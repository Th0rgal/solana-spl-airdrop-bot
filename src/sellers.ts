import { PublicKey } from "@solana/web3.js";
import { config } from "./config";
import { Holder } from "./types";
import { SellerIndexState, loadSellerIndexState, pruneSellerIndexState, saveSellerIndexState } from "./sellerIndex";
import { heliusGet } from "./helius";

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

export type MintTxFetcher = (mint: string, before?: string) => Promise<TxRecord[]>;

interface SellerIndexSyncOptions {
  stateFilePath: string;
  maxStalenessSeconds: number;
}

export class SellerIndexStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellerIndexStaleError";
  }
}

function amountToNumber(value: string | number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  return typeof value === "number" ? value : Number(value);
}

function isTokenOutflow(transfer: TokenTransfer, mint: string): boolean {
  return (
    transfer.mint === mint &&
    !!transfer.fromUserAccount &&
    transfer.fromUserAccount !== transfer.toUserAccount &&
    amountToNumber(transfer.tokenAmount) > 0
  );
}

async function fetchTransactionsSinceCursor(
  mint: string,
  cursorSignature: string | undefined,
  maxPages: number,
  fetchTransactions: MintTxFetcher
): Promise<{ newTransactions: TxRecord[]; foundCursor: boolean; newestSignature?: string }> {
  const newTransactions: TxRecord[] = [];
  let before: string | undefined;
  let foundCursor = false;
  let newestSignature: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const transactions = await fetchTransactions(mint, before);
    if (!Array.isArray(transactions) || transactions.length === 0) {
      break;
    }

    if (!newestSignature) {
      newestSignature = transactions[0]?.signature;
    }

    for (const tx of transactions) {
      const signature = tx.signature;
      if (cursorSignature && signature === cursorSignature) {
        foundCursor = true;
        break;
      }
      newTransactions.push(tx);
    }

    if (foundCursor) {
      break;
    }

    const lastSignature = transactions[transactions.length - 1]?.signature;
    if (!lastSignature) {
      break;
    }
    before = lastSignature;
  }

  return { newTransactions, foundCursor, newestSignature };
}

export async function syncSellerIndex(
  tokenMint: PublicKey,
  lookbackSeconds: number,
  maxPages: number,
  nowUnixSeconds = Math.floor(Date.now() / 1000),
  fetchTransactions?: MintTxFetcher,
  options?: SellerIndexSyncOptions
): Promise<SellerIndexState> {
  const mint = tokenMint.toBase58();
  const settings: SellerIndexSyncOptions = {
    stateFilePath: options?.stateFilePath ?? config.sellerIndexFilePath,
    maxStalenessSeconds: options?.maxStalenessSeconds ?? config.sellerIndexMaxStalenessSeconds
  };
  const resolvedFetcher: MintTxFetcher =
    fetchTransactions ??
    (async (mintAddress, before) => {
      return heliusGet<TxRecord[]>(`/addresses/${mintAddress}/transactions`, {
        limit: 100,
        before
      });
    });

  const existingState = await loadSellerIndexState(settings.stateFilePath);

  try {
    const { newTransactions, foundCursor, newestSignature } = await fetchTransactionsSinceCursor(
      mint,
      existingState.cursorSignature,
      maxPages,
      resolvedFetcher
    );

    const nextState: SellerIndexState = {
      cursorSignature: newestSignature ?? existingState.cursorSignature,
      lastSyncedAtUnix: nowUnixSeconds,
      sellerLastSoldAt: { ...existingState.sellerLastSoldAt }
    };

    for (const tx of newTransactions) {
      const txTimestamp = tx.timestamp ?? 0;
      if (txTimestamp <= 0) {
        continue;
      }

      for (const transfer of tx.tokenTransfers ?? []) {
        if (!isTokenOutflow(transfer, mint) || !transfer.fromUserAccount) {
          continue;
        }
        const current = nextState.sellerLastSoldAt[transfer.fromUserAccount] ?? 0;
        if (txTimestamp > current) {
          nextState.sellerLastSoldAt[transfer.fromUserAccount] = txTimestamp;
        }
      }
    }

    const retentionSeconds = Math.max(lookbackSeconds * 3, 24 * 60 * 60);
    const pruned = pruneSellerIndexState(nextState, nowUnixSeconds, retentionSeconds);
    await saveSellerIndexState(settings.stateFilePath, pruned);

    if (existingState.cursorSignature && !foundCursor && newTransactions.length > 0) {
      console.warn("Seller index cursor was not found within scan pages; advancing cursor to latest observed page.");
    }

    return pruned;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const lastSync = existingState.lastSyncedAtUnix ?? 0;
    const ageSeconds = lastSync > 0 ? nowUnixSeconds - lastSync : Number.POSITIVE_INFINITY;
    if (ageSeconds > settings.maxStalenessSeconds) {
      throw new SellerIndexStaleError(
        `Seller index is stale (${Math.floor(ageSeconds)}s since last sync): ${message}`
      );
    }
    console.warn(`Seller index sync failed, reusing cached state: ${message}`);
    return existingState;
  }
}

export async function excludeRecentSellers(
  holders: Holder[],
  tokenMint: PublicKey,
  lookbackSeconds: number,
  maxPages: number,
  nowUnixSeconds = Math.floor(Date.now() / 1000),
  fetchTransactions?: MintTxFetcher,
  options?: SellerIndexSyncOptions
): Promise<{ eligibleHolders: Holder[]; excludedSellersCount: number }> {
  const state = await syncSellerIndex(
    tokenMint,
    lookbackSeconds,
    maxPages,
    nowUnixSeconds,
    fetchTransactions,
    options
  );
  const cutoff = nowUnixSeconds - lookbackSeconds;

  const eligibleHolders: Holder[] = [];
  let excludedSellersCount = 0;

  for (const holder of holders) {
    const soldAt = state.sellerLastSoldAt[holder.walletAddress] ?? 0;
    if (soldAt >= cutoff) {
      excludedSellersCount += 1;
      continue;
    }
    eligibleHolders.push(holder);
  }

  return { eligibleHolders, excludedSellersCount };
}
