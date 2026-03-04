import { PublicKey } from "@solana/web3.js";

export function isHumanWalletAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBytes());
  } catch {
    return false;
  }
}
