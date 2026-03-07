import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface ResolvedTokenProgram {
  programId: PublicKey;
  decimals: number;
}

export async function resolveTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<ResolvedTokenProgram> {
  try {
    const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
    return { programId: TOKEN_PROGRAM_ID, decimals: mintInfo.decimals };
  } catch {
    // Fall through to Token-2022 detection.
  }

  try {
    const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    return { programId: TOKEN_2022_PROGRAM_ID, decimals: mintInfo.decimals };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read mint ${mint.toBase58()} from SPL Token or Token-2022 programs: ${message}`);
  }
}
