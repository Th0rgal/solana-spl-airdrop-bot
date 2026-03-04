import dotenv from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

dotenv.config();

const REQUIRED_ENV = ["RPC_URL", "HELIUS_API_KEY", "PRIVATE_KEY", "TOKEN_MINT"] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
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
  loopIntervalMs: Number(process.env.LOOP_INTERVAL_MS ?? 60 * 60 * 1000),
  rateLimitPerSecond: Number(process.env.RATE_LIMIT_PER_SECOND ?? 5),
  maxTransferRetries: Number(process.env.MAX_TRANSFER_RETRIES ?? 3),
  minDistributionRaw: BigInt(process.env.MIN_DISTRIBUTION_RAW ?? "1"),
  minAllocationRaw: BigInt(process.env.MIN_ALLOCATION_RAW ?? "1"),
  sellerLookbackSeconds: Number(process.env.SELLER_LOOKBACK_SECONDS ?? 3600)
};

export type BotConfig = typeof config;
