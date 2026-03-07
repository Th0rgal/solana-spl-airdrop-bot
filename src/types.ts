export interface Holder {
  walletAddress: string;
  balanceRaw: bigint;
}

export interface Allocation {
  walletAddress: string;
  amountRaw: bigint;
}

export interface RoundLog {
  timestamp: string;
  bot_balance: string;
  distribution_pool: string;
  total_allocated?: string;
  eligible_holders_count: number;
  excluded_sellers_count: number;
  attempted_transfers?: number;
  tx_hashes: string[];
  skipped_reason?: string;
  failed_transfers?: Array<{ wallet: string; amount: string; error: string }>;
}
