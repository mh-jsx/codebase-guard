import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(path.resolve(process.cwd(), "src/ui/control-center.ts"), "utf8");

test("control center explains automatic scanning and the safety boundary", () => {
  for (const message of ["Automatic scanning is on", "Local only", "No code run", "No telemetry"]) {
    assert.equal(source.includes(message), true, `missing trust copy: ${message}`);
  }
});

test("finding cards expose named actions without relying on hover", () => {
  for (const label of ["Files needing attention", "Open file", "Hide alert", "Skip file", "Skip folder"]) {
    assert.equal(source.includes(label), true, `missing finding action: ${label}`);
  }
  assert.equal(source.includes("Hover a finding"), false);
});

test("control center keeps scan as the one primary action even when findings exist", () => {
  assert.equal((source.match(/class=\"primary-action\"/g) ?? []).length, 1);
  assert.equal(source.includes('elements.primaryAction.dataset.command = "scanWorkspace"'), true);
  assert.equal(source.includes('elements.primaryAction.dataset.command = "showFindings"'), false);
  assert.equal(source.includes('model.scannedAt ? "Scan again" : "Scan workspace"'), true);
});

test("control center exposes resource-aware automatic scan modes", () => {
  for (const mode of ['data-mode="live"', 'data-mode="open"', 'data-mode="manual"', "rechecks relevant changed files", "Nothing scans in the background"]) {
    assert.equal(source.includes(mode), true, `missing scan-mode UX: ${mode}`);
  }
});

test("current file and exclusion controls are always visible and named", () => {
  for (const label of ["Current location", "Scan file", "Skip file", "Skip folder", "Manage skipped items"]) {
    assert.equal(source.includes(label), true, `missing current-location action: ${label}`);
  }
  assert.equal(source.includes('data-skip-current="file"'), true);
  assert.equal(source.includes('data-skip-current="folder"'), true);
});

test("webview finding actions use bounded validated identifiers", () => {
  assert.equal(source.includes('message.command === "findingAction"'), true);
  assert.equal(source.includes("message.fingerprint.length <= 512"), true);
  assert.equal(source.includes("localResourceRoots: []"), true);
});
