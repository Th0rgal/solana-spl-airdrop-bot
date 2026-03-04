import { promises as fs } from "fs";
import path from "path";

export interface SellerIndexState {
  cursorSignature?: string;
  lastSyncedAtUnix?: number;
  sellerLastSoldAt: Record<string, number>;
}

function isValidRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((entry) => Number.isFinite(entry) && entry > 0);
}

export async function loadSellerIndexState(stateFilePath: string): Promise<SellerIndexState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SellerIndexState>;
    const sellerLastSoldAt = isValidRecord(parsed.sellerLastSoldAt) ? parsed.sellerLastSoldAt : {};

    const cursorSignature =
      typeof parsed.cursorSignature === "string" && parsed.cursorSignature.length > 0
        ? parsed.cursorSignature
        : undefined;
    const lastSyncedAtUnix =
      typeof parsed.lastSyncedAtUnix === "number" && Number.isFinite(parsed.lastSyncedAtUnix)
        ? parsed.lastSyncedAtUnix
        : undefined;

    return { cursorSignature, lastSyncedAtUnix, sellerLastSoldAt };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { sellerLastSoldAt: {} };
    }
    throw error;
  }
}

export async function saveSellerIndexState(stateFilePath: string, state: SellerIndexState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const tempPath = `${stateFilePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, stateFilePath);
}

export function pruneSellerIndexState(
  state: SellerIndexState,
  nowUnixSeconds: number,
  retentionSeconds: number
): SellerIndexState {
  const cutoff = nowUnixSeconds - Math.max(retentionSeconds, 1);
  const filteredEntries = Object.entries(state.sellerLastSoldAt).filter(([, soldAt]) => soldAt >= cutoff);

  return {
    cursorSignature: state.cursorSignature,
    lastSyncedAtUnix: state.lastSyncedAtUnix,
    sellerLastSoldAt: Object.fromEntries(filteredEntries)
  };
}
