import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { fetchTokenHolders } from "../src/holders";

function wallet(): string {
  return Keypair.generate().publicKey.toBase58();
}

test("fetchTokenHolders filters bot wallet and zero balances", async () => {
  const mint = Keypair.generate().publicKey;
  const bot = Keypair.generate().publicKey;
  const included = wallet();

  const result = await fetchTokenHolders(
    mint,
    bot,
    0,
    async () => ({
      token_accounts: [
        { owner: bot.toBase58(), amount: "100" },
        { owner: included, amount: "50" },
        { owner: wallet(), amount: "0" }
      ]
    })
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.walletAddress, included);
  assert.equal(result[0]?.balanceRaw, 50n);
});

test("fetchTokenHolders supports paginationToken responses", async () => {
  const mint = Keypair.generate().publicKey;
  const bot = Keypair.generate().publicKey;
  const a = wallet();
  const b = wallet();
  const calls: string[] = [];

  const result = await fetchTokenHolders(mint, bot, 0, async (_mint, _page, _limit, paginationToken) => {
    calls.push(paginationToken ?? "none");
    if (!paginationToken) {
      return {
        holders: [{ ownerAddress: a, amount: "10" }],
        paginationToken: "page-2"
      };
    }

    return {
      holders: [{ ownerAddress: b, amount: "20" }]
    };
  });

  assert.deepEqual(calls, ["none", "page-2"]);
  assert.deepEqual(
    result.map((entry) => entry.walletAddress),
    [a, b]
  );
});

test("fetchTokenHolders tolerates malformed balance fields and falls back", async () => {
  const mint = Keypair.generate().publicKey;
  const bot = Keypair.generate().publicKey;
  const target = wallet();

  const result = await fetchTokenHolders(mint, bot, 2, async () => [
    {
      owner: target,
      amount: "not-a-number",
      uiAmount: "1.50"
    }
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.balanceRaw, 150n);
});
