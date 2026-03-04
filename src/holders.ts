import { PublicKey } from "@solana/web3.js";
import { heliusGet } from "./helius";
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

function decimalToRaw(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const wholePart = BigInt(whole || "0") * 10n ** BigInt(decimals);
  const fractionPart = BigInt(normalizedFraction || "0");
  return wholePart + fractionPart;
}

function parseRawBalance(raw: RawHolder, decimals: number): bigint {
  const candidates = [raw.amount, raw.balance, raw.token_balance, raw.uiAmount];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }

    if (typeof candidate === "number") {
      if (Number.isInteger(candidate)) {
        return BigInt(candidate);
      }
      return decimalToRaw(String(candidate), decimals);
    }

    if (typeof candidate === "string") {
      if (candidate.includes(".")) {
        return decimalToRaw(candidate, decimals);
      }
      return BigInt(candidate);
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
  decimals: number
): Promise<Holder[]> {
  const holders: Holder[] = [];
  let page = 1;
  const limit = 1000;

  while (true) {
    const result = await heliusGet<RawHolder[]>("/token-holders", {
      mint: tokenMint.toBase58(),
      page,
      limit
    });

    if (!Array.isArray(result) || result.length === 0) {
      break;
    }

    for (const entry of result) {
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

    if (result.length < limit) {
      break;
    }

    page += 1;
  }

  return holders;
}
