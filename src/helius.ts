import axios from "axios";
import { config } from "./config";
import { sleep } from "./utils";

const helius = axios.create({
  baseURL: "https://api.helius.xyz/v0",
  timeout: 30_000
});

export async function heliusGet<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const query = { ...params, "api-key": config.heliusApiKey };
  const maxRetries = 4;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await helius.get<T>(path, { params: query });
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isLast = attempt === maxRetries;
      if (isLast) {
        throw new Error(`Helius request failed for ${path}: ${message}`);
      }
      await sleep(250 * attempt);
    }
  }

  throw new Error("Unreachable heliusGet retry state");
}
