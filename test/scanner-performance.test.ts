import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve(process.cwd(), "src/workspace/scanner.ts"), "utf8");

test("live monitoring uses one subscription and a bounded two-reader queue", () => {
  assert.equal((source.match(/createFileSystemWatcher\s*\(/g) ?? []).length, 1);
  assert.match(source, /FILE_READ_CONCURRENCY\s*=\s*2/);
  assert.match(source, /ChangeBatch<vscode\.Uri>/);
  assert.equal(source.includes("Map<string, ReturnType<typeof setTimeout>>"), false);
});

test("monitoring can be fully disposed outside live mode", () => {
  assert.match(source, /shouldMonitor\s*=\s*readSettings\(\)\.enabled\s*&&\s*mode\s*===\s*"live"/);
  assert.match(source, /for \(const disposable of this\.monitoringDisposables\.splice\(0\)\) disposable\.dispose\(\)/);
});
