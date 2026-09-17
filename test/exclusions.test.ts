import assert from "node:assert/strict";
import test from "node:test";
import { findingExclusionChoices } from "../src/workspace/exclusions";

test("a finding offers its file and every parent folder from nearest to broadest", () => {
  assert.deepEqual(findingExclusionChoices("packages/app/out/chunks/unsafe.js"), [
    { kind: "file", path: "packages/app/out/chunks/unsafe.js", pattern: "packages/app/out/chunks/unsafe.js" },
    { kind: "folder", path: "packages/app/out/chunks", pattern: "packages/app/out/chunks/**" },
    { kind: "folder", path: "packages/app/out", pattern: "packages/app/out/**" },
    { kind: "folder", path: "packages/app", pattern: "packages/app/**" },
    { kind: "folder", path: "packages", pattern: "packages/**" }
  ]);
});

test("root files can be skipped without offering the whole codebase", () => {
  assert.deepEqual(findingExclusionChoices("postcss.config.mjs"), [
    { kind: "file", path: "postcss.config.mjs", pattern: "postcss.config.mjs" }
  ]);
});

test("finding exclusion choices normalize platform separators", () => {
  assert.deepEqual(findingExclusionChoices("out\\chunks\\unsafe.js").map(choice => choice.pattern), [
    "out/chunks/unsafe.js",
    "out/chunks/**",
    "out/**"
  ]);
});
