import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { computeNextDelayMs, loadState, saveState } from "../src/state";

test("computeNextDelayMs returns zero when no previous round exists", () => {
  assert.equal(computeNextDelayMs(undefined, undefined, 3_600_000, 10_000), 0);
});

test("computeNextDelayMs returns remaining wait time", () => {
  const delay = computeNextDelayMs(undefined, 10_000, 3_600_000, 20_000);
  assert.equal(delay, 3_590_000);
});

test("computeNextDelayMs never returns negative values", () => {
  const delay = computeNextDelayMs(undefined, 10_000, 1_000, 20_000);
  assert.equal(delay, 0);
});

test("computeNextDelayMs uses last attempted round as scheduler anchor", () => {
  const delay = computeNextDelayMs(20_000, 10_000, 3_600_000, 30_000);
  assert.equal(delay, 3_590_000);
});

test("loadState returns empty object for missing file", async () => {
  const missing = path.resolve("temp", `missing-${Date.now()}.json`);
  const state = await loadState(missing);
  assert.deepEqual(state, {});
});

test("saveState persists and loadState restores values", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-test-"));
  const filePath = path.join(baseDir, "state.json");
  try {
    await saveState(filePath, {
      lastRoundAttemptedAtMs: 123_000,
      lastRoundCompletedAtMs: 123_456
    });
    const state = await loadState(filePath);
    assert.deepEqual(state, {
      lastRoundAttemptedAtMs: 123_000,
      lastRoundCompletedAtMs: 123_456
    });
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});
