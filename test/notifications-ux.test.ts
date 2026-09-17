import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve(process.cwd(), "src/ui/notifications.ts"), "utf8");

test("critical findings use one summary notification instead of a per-finding queue", () => {
  assert.equal((source.match(/showErrorMessage\(/g) ?? []).length, 2, "the two branches belong to one summary call path");
  assert.equal(source.includes("private queue"), false);
  assert.equal(source.includes("this.queue.then"), false);
  assert.equal(source.includes("showSummary(fresh, open)"), true);
});

test("only one critical notification is shown during an active scan batch", () => {
  assert.equal(source.includes("notifiedDuringActivity"), true);
  assert.equal(source.includes('snapshot.activity !== "idle" && this.notifiedDuringActivity'), true);
  assert.equal(source.includes("this.showing"), true);
});

test("the summary keeps all findings available in the persistent UI", () => {
  for (const surface of ["Control Center", "Problems panel", "tree view", "status bar"]) {
    assert.equal(source.includes(surface), true, `missing persistent surface: ${surface}`);
  }
  assert.equal(source.includes('"Review Findings"'), true);
});
