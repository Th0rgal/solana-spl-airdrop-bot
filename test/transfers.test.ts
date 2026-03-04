import test from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { executeTransfers } from "../src/transfers";

test("executeTransfers in dry run returns synthetic tx hashes and no failures", async () => {
  const payer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const recipientA = Keypair.generate().publicKey.toBase58();
  const recipientB = Keypair.generate().publicKey.toBase58();

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  const result = await executeTransfers(
    connection,
    payer,
    mint,
    TOKEN_PROGRAM_ID,
    [
      { walletAddress: recipientA, amountRaw: 10n },
      { walletAddress: recipientB, amountRaw: 20n }
    ],
    1000,
    1,
    true
  );

  assert.equal(result.failedTransfers.length, 0);
  assert.equal(result.txHashes.length, 2);
  assert.ok(result.txHashes[0]?.startsWith(`dry-run:${recipientA}:10`));
  assert.ok(result.txHashes[1]?.startsWith(`dry-run:${recipientB}:20`));
});

test("executeTransfers skips off-curve recipients", async () => {
  const payer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey.toBase58();
  const [offCurveRecipient] = PublicKey.findProgramAddressSync([Buffer.from("owner")], Keypair.generate().publicKey);

  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  const result = await executeTransfers(
    connection,
    payer,
    mint,
    TOKEN_PROGRAM_ID,
    [
      { walletAddress: recipient, amountRaw: 10n },
      { walletAddress: offCurveRecipient.toBase58(), amountRaw: 20n }
    ],
    1000,
    1,
    true
  );

  assert.equal(result.txHashes.length, 1);
  assert.ok(result.txHashes[0]?.startsWith(`dry-run:${recipient}:10`));
  assert.equal(result.failedTransfers.length, 1);
  assert.equal(result.failedTransfers[0]?.wallet, offCurveRecipient.toBase58());
  assert.equal(
    result.failedTransfers[0]?.error,
    "Recipient is not a human wallet (off-curve or invalid address)"
  );
});
