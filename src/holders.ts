import { PublicKey } from "@solana/web3.js";
import { Holder } from "./types";

interface RawHolder {
  owner?: string;
  ownerAddress?: string;
  address?: string;
  token_balance?: string | number;
  amount?: string | number;
  balance?: string | number;
  uiAmount?: string | number;
}

interface RawHoldersResponseObject {
  token_accounts?: RawHolder[];
  holders?: RawHolder[];
  result?: RawHolder[];
  paginationToken?: string;
}

type RawHoldersResponse = RawHolder[] | RawHoldersResponseObject;
type HoldersFetcher = (
  tokenMint: PublicKey,
  page: number,
  limit: number,
  paginationToken?: string
) => Promise<RawHoldersResponse>;

function decimalToRaw(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const wholePart = BigInt(whole || "0") * 10n ** BigInt(decimals);
  const fractionPart = BigInt(normalizedFraction || "0");
  return wholePart + fractionPart;
}

function parseRawBalance(raw: RawHolder, decimals: number): bigint {
  const candidates: Array<{ value: string | number | undefined; isUiAmount: boolean }> = [
    { value: raw.amount, isUiAmount: false },
    { value: raw.balance, isUiAmount: false },
    { value: raw.token_balance, isUiAmount: false },
    { value: raw.uiAmount, isUiAmount: true }
  ];

  for (const candidate of candidates) {
    const value = candidate.value;
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      if (candidate.isUiAmount) {
        return decimalToRaw(String(value), decimals);
      }
      if (Number.isInteger(value)) {
        return BigInt(Math.trunc(value));
      }
      return decimalToRaw(String(value), decimals);
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized.length === 0) {
        continue;
      }

      if (candidate.isUiAmount || normalized.includes(".")) {
        return decimalToRaw(normalized, decimals);
      }

      try {
        return BigInt(normalized);
      } catch {
        continue;
      }
    }
  }

  return 0n;
}

function getWalletAddress(raw: RawHolder): string | null {
  return raw.owner ?? raw.ownerAddress ?? raw.address ?? null;
}

export async function fetchTokenHolders(
  tokenMint: PublicKey,
  botWallet: PublicKey,
  decimals: number,
  fetchPage?: HoldersFetcher
): Promise<Holder[]> {
  const holders: Holder[] = [];
  let page = 1;
  const limit = 1000;
  let paginationToken: string | undefined;
  const resolvedFetchPage: HoldersFetcher =
    fetchPage ??
    (async (mint, currentPage, currentLimit, currentPaginationToken) => {
      const { heliusGet } = await import("./helius");
      return heliusGet<RawHoldersResponse>("/token-holders", {
        mint: mint.toBase58(),
        page: currentPage,
        limit: currentLimit,
        paginationToken: currentPaginationToken
      });
    });

  while (true) {
    const result = await resolvedFetchPage(tokenMint, page, limit, paginationToken);

    const entries: RawHolder[] = Array.isArray(result)
      ? result
      : result.token_accounts ?? result.holders ?? result.result ?? [];

    if (entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      const walletAddress = getWalletAddress(entry);
      if (!walletAddress) {
        continue;
      }

      if (walletAddress === botWallet.toBase58()) {
        continue;
      }

      const balanceRaw = parseRawBalance(entry, decimals);
      if (balanceRaw <= 0n) {
        continue;
      }

      holders.push({ walletAddress, balanceRaw });
    }

    if (!Array.isArray(result)) {
      paginationToken = result.paginationToken;
      if (!paginationToken) {
        break;
      }
    } else {
      if (entries.length < limit) {
        break;
      }
      page += 1;
    }
  }

  return holders;
}
