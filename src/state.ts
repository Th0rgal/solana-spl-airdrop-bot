import { promises as fs } from "fs";
import path from "path";

export interface BotState {
  lastRoundAttemptedAtMs?: number;
  lastRoundCompletedAtMs?: number;
}

export function computeNextDelayMs(
  lastRoundAttemptedAtMs: number | undefined,
  lastRoundCompletedAtMs: number | undefined,
  intervalMs: number,
  nowMs: number
): number {
  if (intervalMs <= 0) {
    return 0;
  }

  const anchor = Math.max(lastRoundAttemptedAtMs ?? 0, lastRoundCompletedAtMs ?? 0);
  if (anchor <= 0) {
    return 0;
  }

  const nextAllowed = anchor + intervalMs;
  return Math.max(nextAllowed - nowMs, 0);
}

export async function loadState(stateFilePath: string): Promise<BotState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as BotState;

    const attemptedValid =
      parsed.lastRoundAttemptedAtMs === undefined ||
      (Number.isFinite(parsed.lastRoundAttemptedAtMs) && parsed.lastRoundAttemptedAtMs > 0);
    const completedValid =
      parsed.lastRoundCompletedAtMs === undefined ||
      (Number.isFinite(parsed.lastRoundCompletedAtMs) && parsed.lastRoundCompletedAtMs > 0);

    if (!attemptedValid || !completedValid) {
      return {};
    }

    return parsed;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveState(stateFilePath: string, state: BotState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const tempPath = `${stateFilePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, stateFilePath);
}
