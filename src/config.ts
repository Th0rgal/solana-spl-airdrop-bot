import dotenv from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import path from "path";

dotenv.config();

const REQUIRED_ENV = ["RPC_URL", "HELIUS_API_KEY", "PRIVATE_KEY", "TOKEN_MINT"] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

function parsePositiveInt(rawValue: string | undefined, fallback: number, name: string): number {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.floor(value);
}

function parseBoolean(rawValue: string | undefined, fallback = false): boolean {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parsePrivateKey(secret: string): Uint8Array {
  const trimmed = secret.trim();

  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr) || arr.some((x) => typeof x !== "number")) {
        throw new Error("PRIVATE_KEY JSON format is invalid");
      }
      return Uint8Array.from(arr);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse PRIVATE_KEY as JSON array: ${message}`);
    }
  }

  try {
    return bs58.decode(trimmed);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse PRIVATE_KEY as base58: ${message}`);
  }
}

const secretKey = parsePrivateKey(process.env.PRIVATE_KEY as string);
const keypair = Keypair.fromSecretKey(secretKey);

export const config = {
  rpcUrl: process.env.RPC_URL as string,
  heliusApiKey: process.env.HELIUS_API_KEY as string,
  tokenMint: new PublicKey(process.env.TOKEN_MINT as string),
  botKeypair: keypair,
  loopIntervalMs: parsePositiveInt(process.env.LOOP_INTERVAL_MS, 60 * 60 * 1000, "LOOP_INTERVAL_MS"),
  rateLimitPerSecond: parsePositiveInt(process.env.RATE_LIMIT_PER_SECOND, 5, "RATE_LIMIT_PER_SECOND"),
  maxTransferRetries: parsePositiveInt(process.env.MAX_TRANSFER_RETRIES, 3, "MAX_TRANSFER_RETRIES"),
  skipPreflight: parseBoolean(process.env.SKIP_PREFLIGHT, false),
  minDistributionRaw: BigInt(process.env.MIN_DISTRIBUTION_RAW ?? "1"),
  minAllocationRaw: BigInt(process.env.MIN_ALLOCATION_RAW ?? "1"),
  sellerLookbackSeconds: parsePositiveInt(process.env.SELLER_LOOKBACK_SECONDS, 3600, "SELLER_LOOKBACK_SECONDS"),
  sellerMintTxScanMaxPages: parsePositiveInt(
    process.env.SELLER_MINT_TX_SCAN_MAX_PAGES ?? process.env.SELLER_TX_SCAN_MAX_PAGES,
    20,
    "SELLER_MINT_TX_SCAN_MAX_PAGES"
  ),
  sellerIndexMaxStalenessSeconds: parsePositiveInt(
    process.env.SELLER_INDEX_MAX_STALENESS_SECONDS,
    2 * 60 * 60,
    "SELLER_INDEX_MAX_STALENESS_SECONDS"
  ),
  stateFilePath: path.resolve(process.cwd(), process.env.STATE_FILE_PATH ?? "state/bot-state.json"),
  sellerIndexFilePath: path.resolve(
    process.cwd(),
    process.env.SELLER_INDEX_STATE_FILE_PATH ?? "state/seller-index.json"
  ),
  dryRun: parseBoolean(process.env.DRY_RUN, false),
  runOnce: parseBoolean(process.env.RUN_ONCE, false)
};

export type BotConfig = typeof config;
