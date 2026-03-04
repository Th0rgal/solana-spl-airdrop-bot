import { Connection, ParsedAccountData, PublicKey } from "@solana/web3.js";
import { Holder } from "./types";

interface TokenTransferLike {
  mint?: string;
  fromUserAccount?: string;
  toUserAccount?: string;
  tokenAmount?: string | number;
}

interface MintTxLike {
  signature?: string;
  timestamp?: number;
  tokenTransfers?: TokenTransferLike[];
}

function toBigIntAmount(value: unknown): bigint {
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return BigInt(value);
  }
  return 0n;
}

export async function fetchTokenHoldersViaRpc(
  connection: Connection,
  tokenMint: PublicKey,
  botWallet: PublicKey,
  tokenProgramId: PublicKey
): Promise<Holder[]> {
  const mint = tokenMint.toBase58();
  const accounts = await connection.getParsedProgramAccounts(tokenProgramId, {
    filters: [{ memcmp: { offset: 0, bytes: mint } }],
    commitment: "confirmed"
  });

  const holderBalances = new Map<string, bigint>();

  for (const account of accounts) {
    const parsed = account.account.data as ParsedAccountData;
    const info = parsed?.parsed?.info as
      | { owner?: string; tokenAmount?: { amount?: string } }
      | undefined;

    const owner = info?.owner;
    const amountRaw = toBigIntAmount(info?.tokenAmount?.amount);
    if (!owner || amountRaw <= 0n) {
      continue;
    }
    holderBalances.set(owner, (holderBalances.get(owner) ?? 0n) + amountRaw);
  }

  const botWalletAddress = botWallet.toBase58();
  const holders: Holder[] = [];
  for (const [walletAddress, balanceRaw] of holderBalances.entries()) {
    if (walletAddress === botWalletAddress || balanceRaw <= 0n) {
      continue;
    }
    holders.push({ walletAddress, balanceRaw });
  }

  return holders;
}

function aggregateOwnerBalances(
  balances: Array<{ owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }> | null | undefined,
  mint: string
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  if (!balances) {
    return totals;
  }

  for (const balance of balances) {
    if (balance.mint !== mint || !balance.owner) {
      continue;
    }
    const amount = toBigIntAmount(balance.uiTokenAmount?.amount);
    totals.set(balance.owner, (totals.get(balance.owner) ?? 0n) + amount);
  }

  return totals;
}

function extractOutflowsForMint(
  mint: string,
  preTokenBalances: Array<{ owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }> | null | undefined,
  postTokenBalances: Array<{ owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }> | null | undefined
): TokenTransferLike[] {
  const pre = aggregateOwnerBalances(preTokenBalances, mint);
  const post = aggregateOwnerBalances(postTokenBalances, mint);
  const owners = new Set<string>([...pre.keys(), ...post.keys()]);
  const outflows: TokenTransferLike[] = [];

  for (const owner of owners) {
    const preAmount = pre.get(owner) ?? 0n;
    const postAmount = post.get(owner) ?? 0n;
    if (postAmount >= preAmount) {
      continue;
    }
    outflows.push({
      mint,
      fromUserAccount: owner,
      toUserAccount: "",
      tokenAmount: (preAmount - postAmount).toString()
    });
  }

  return outflows;
}

export async function fetchMintTransactionsViaRpc(
  connection: Connection,
  tokenMint: PublicKey,
  before?: string
): Promise<MintTxLike[]> {
  const signatures = await connection.getSignaturesForAddress(
    tokenMint,
    { before, limit: 100 },
    "confirmed"
  );

  if (signatures.length === 0) {
    return [];
  }

  const parsedTxs = await connection.getParsedTransactions(
    signatures.map((entry) => entry.signature),
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
  );

  const mint = tokenMint.toBase58();
  const result: MintTxLike[] = [];

  for (let i = 0; i < signatures.length; i += 1) {
    const signatureInfo = signatures[i];
    const parsedTx = parsedTxs[i];
    const meta = parsedTx?.meta;
    const tokenTransfers = extractOutflowsForMint(mint, meta?.preTokenBalances, meta?.postTokenBalances);
    result.push({
      signature: signatureInfo.signature,
      timestamp: signatureInfo.blockTime ?? 0,
      tokenTransfers
    });
  }

  return result;
}
