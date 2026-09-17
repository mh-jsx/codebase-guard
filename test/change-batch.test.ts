import assert from "node:assert/strict";
import test from "node:test";
import { ChangeBatch } from "../src/workspace/change-batch";
import { runWithConcurrency } from "../src/workspace/work-pool";

test("a large event burst is coalesced to one latest operation per file", () => {
  const batch = new ChangeBatch<number>();
  for (let event = 0; event < 10_000; event += 1) {
    const file = event % 1_000;
    batch.upsert({ key: `file-${file}`, value: event, kind: event >= 9_000 ? "delete" : "scan", priority: file < 10 ? 0 : 10 });
  }

  assert.equal(batch.size, 1_000);
  const drained = batch.drain();
  assert.equal(drained.length, 1_000);
  assert.equal(drained.every(item => item.kind === "delete"), true);
  assert.equal(drained.slice(0, 10).every(item => item.priority === 0), true);
  assert.equal(batch.size, 0);
});

test("the work pool never exceeds its configured concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  await runWithConcurrency(Array.from({ length: 50 }, (_, index) => index), 2, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
  });
  assert.equal(maximumActive, 2);
});
