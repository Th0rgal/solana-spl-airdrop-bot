import { promises as fs } from "fs";
import path from "path";

export interface BotState {
  lastRoundCompletedAtMs?: number;
}

export function computeNextDelayMs(
  lastRoundCompletedAtMs: number | undefined,
  intervalMs: number,
  nowMs: number
): number {
  if (!lastRoundCompletedAtMs || intervalMs <= 0) {
    return 0;
  }

  const nextAllowed = lastRoundCompletedAtMs + intervalMs;
  return Math.max(nextAllowed - nowMs, 0);
}

export async function loadState(stateFilePath: string): Promise<BotState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as BotState;

    if (
      parsed.lastRoundCompletedAtMs !== undefined &&
      (!Number.isFinite(parsed.lastRoundCompletedAtMs) || parsed.lastRoundCompletedAtMs <= 0)
    ) {
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
