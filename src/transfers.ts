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
import { sleep } from "./utils";

async function transferWithRetry(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  tokenProgramId: PublicKey,
  sourceTokenAccount: PublicKey,
  destinationOwner: PublicKey,
  amountRaw: bigint,
  maxRetries: number,
  skipPreflight: boolean
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        destinationOwner,
        false,
        "confirmed",
        { skipPreflight },
        tokenProgramId
      );

      const signature = await transfer(
        connection,
        payer,
        sourceTokenAccount,
        destinationTokenAccount.address,
        payer.publicKey,
        amountRaw,
        [],
        { skipPreflight },
        tokenProgramId
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
  tokenProgramId: PublicKey,
  allocations: Allocation[],
  rateLimitPerSecond: number,
  maxRetries: number,
  dryRun = false,
  skipPreflight = false
): Promise<{ txHashes: string[]; failedTransfers: Array<{ wallet: string; amount: string; error: string }> }> {
  const txHashes: string[] = [];
  const failedTransfers: Array<{ wallet: string; amount: string; error: string }> = [];

  const sourceTokenAccount = getAssociatedTokenAddressSync(mint, payer.publicKey, false, tokenProgramId);
  const spacingMs = Math.max(Math.floor(1000 / Math.max(1, rateLimitPerSecond)), 1);

  for (const allocation of allocations) {
    try {
      const recipient = new PublicKey(allocation.walletAddress);
      if (dryRun) {
        const simulatedId = `dry-run:${recipient.toBase58()}:${allocation.amountRaw.toString()}`;
        txHashes.push(simulatedId);
        console.log(`Dry-run transfer: ${allocation.walletAddress} -> ${allocation.amountRaw.toString()}`);
        await sleep(spacingMs);
        continue;
      }

      const signature = await transferWithRetry(
        connection,
        payer,
        mint,
        tokenProgramId,
        sourceTokenAccount,
        recipient,
        allocation.amountRaw,
        maxRetries,
        skipPreflight
      );

      txHashes.push(signature);
      console.log(`Transfer success: ${allocation.walletAddress} -> ${allocation.amountRaw.toString()} (${signature})`);
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = rawMessage && rawMessage.trim().length > 0 ? rawMessage : "Unknown transfer error";
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
