import { PublicKey } from "@solana/web3.js";
import { Holder } from "./types";
import { isHumanWalletAddress } from "./wallets";

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
  const trimmed = value.trim();
  const isNegative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const normalizedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const wholePart = BigInt(whole || "0") * 10n ** BigInt(decimals);
  const fractionPart = BigInt(normalizedFraction || "0");
  const absolute = wholePart + fractionPart;
  return isNegative ? -absolute : absolute;
}

function parseRawDecimal(value: string, decimals: number): bigint | null {
  try {
    return decimalToRaw(value, decimals);
  } catch {
    return null;
  }
}

function parseRawIntegerLike(value: string): bigint | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (/^[+-]?\d+$/.test(normalized)) {
    try {
      return BigInt(normalized);
    } catch {
      return null;
    }
  }
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) {
    return null;
  }
  return BigInt(Math.trunc(asNumber));
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
        const decimalParsed = parseRawDecimal(String(value), decimals);
        if (decimalParsed !== null) {
          return decimalParsed;
        }
        continue;
      }
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized.length === 0) {
        continue;
      }

      if (candidate.isUiAmount) {
        const decimalParsed = parseRawDecimal(normalized, decimals);
        if (decimalParsed !== null) {
          return decimalParsed;
        }
        continue;
      }

      const integerLike = parseRawIntegerLike(normalized);
      if (integerLike !== null) {
        return integerLike;
      }
      continue;
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
  const holdersByWallet = new Map<string, bigint>();
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
      if (!isHumanWalletAddress(walletAddress)) {
        continue;
      }

      const balanceRaw = parseRawBalance(entry, decimals);
      if (balanceRaw <= 0n) {
        continue;
      }

      const previous = holdersByWallet.get(walletAddress) ?? 0n;
      holdersByWallet.set(walletAddress, previous + balanceRaw);
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

  return Array.from(holdersByWallet.entries()).map(([walletAddress, balanceRaw]) => ({
    walletAddress,
    balanceRaw
  }));
}
