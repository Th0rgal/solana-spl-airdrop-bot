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

export type MintTxFetcher = (mint: string, before?: string) => Promise<TxRecord[]>;

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

async function fetchRecentSellersForMint(
  mint: string,
  minTimestamp: number,
  maxPages: number,
  fetchTransactions: MintTxFetcher
): Promise<Set<string>> {
  const sellers = new Set<string>();
  let before: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const transactions = await fetchTransactions(mint, before);

    if (!Array.isArray(transactions) || transactions.length === 0) {
      break;
    }

    let foundTxInWindow = false;
    for (const tx of transactions) {
      const txTimestamp = tx.timestamp ?? 0;
      if (txTimestamp < minTimestamp) {
        continue;
      }

      foundTxInWindow = true;
      const transfers = tx.tokenTransfers ?? [];
      for (const transfer of transfers) {
        if (isTokenOutflow(transfer, mint) && transfer.fromUserAccount) {
          sellers.add(transfer.fromUserAccount);
        }
      }
    }

    if (!foundTxInWindow) {
      break;
    }

    const lastSignature = transactions[transactions.length - 1]?.signature;
    if (!lastSignature) {
      break;
    }
    before = lastSignature;
  }

  return sellers;
}

export async function excludeRecentSellers(
  holders: Holder[],
  tokenMint: PublicKey,
  lookbackSeconds: number,
  maxPages: number,
  nowUnixSeconds = Math.floor(Date.now() / 1000),
  fetchTransactions?: MintTxFetcher
): Promise<{ eligibleHolders: Holder[]; excludedSellersCount: number }> {
  const minTimestamp = nowUnixSeconds - lookbackSeconds;
  const mint = tokenMint.toBase58();

  const resolvedFetcher: MintTxFetcher =
    fetchTransactions ??
    (async (mintAddress, before) => {
      const { heliusGet } = await import("./helius");
      return heliusGet<TxRecord[]>(`/addresses/${mintAddress}/transactions`, {
        limit: 100,
        before
      });
    });

  let sellerSet = new Set<string>();
  try {
    sellerSet = await fetchRecentSellersForMint(mint, minTimestamp, maxPages, resolvedFetcher);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to inspect global seller activity for mint ${mint}: ${message}`);
  }

  const eligibleHolders: Holder[] = [];
  let excludedSellersCount = 0;

  for (const holder of holders) {
    if (sellerSet.has(holder.walletAddress)) {
      excludedSellersCount += 1;
    } else {
      eligibleHolders.push(holder);
    }
  }

  return { eligibleHolders, excludedSellersCount };
}
