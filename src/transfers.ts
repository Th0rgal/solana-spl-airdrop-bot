import {
  Connection,
  Keypair,
  PublicKey
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transfer
} from "@solana/spl-token";
import { Allocation } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transferWithRetry(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  sourceTokenAccount: PublicKey,
  destinationOwner: PublicKey,
  amountRaw: bigint,
  maxRetries: number
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        destinationOwner
      );

      const signature = await transfer(
        connection,
        payer,
        sourceTokenAccount,
        destinationTokenAccount.address,
        payer.publicKey,
        amountRaw
      );

      return signature;
    } catch (error: unknown) {
      const isLast = attempt === maxRetries;
      if (isLast) {
        throw error;
      }
      await sleep(300 * attempt);
    }
  }

  throw new Error("Unreachable transfer retry state");
}

export async function executeTransfers(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  allocations: Allocation[],
  rateLimitPerSecond: number,
  maxRetries: number
): Promise<{ txHashes: string[]; failedTransfers: Array<{ wallet: string; amount: string; error: string }> }> {
  const txHashes: string[] = [];
  const failedTransfers: Array<{ wallet: string; amount: string; error: string }> = [];

  const sourceTokenAccount = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const spacingMs = Math.max(Math.floor(1000 / Math.max(1, rateLimitPerSecond)), 1);

  for (const allocation of allocations) {
    try {
      const recipient = new PublicKey(allocation.walletAddress);
      const signature = await transferWithRetry(
        connection,
        payer,
        mint,
        sourceTokenAccount,
        recipient,
        allocation.amountRaw,
        maxRetries
      );

      txHashes.push(signature);
      console.log(`Transfer success: ${allocation.walletAddress} -> ${allocation.amountRaw.toString()} (${signature})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failedTransfers.push({
        wallet: allocation.walletAddress,
        amount: allocation.amountRaw.toString(),
        error: message
      });
      console.error(`Transfer failed for ${allocation.walletAddress}: ${message}`);
    }

    await sleep(spacingMs);
  }

  return { txHashes, failedTransfers };
}
