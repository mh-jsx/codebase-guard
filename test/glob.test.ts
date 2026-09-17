import assert from "node:assert/strict";
import test from "node:test";
import { matchesAnyGlob } from "../src/workspace/glob";

test("user exclusion globs work across platform separators", () => {
  assert.equal(matchesAnyGlob("generated\\safe.js", ["generated/**"]), true);
  assert.equal(matchesAnyGlob("src/safe.js", ["generated/**"]), false);
  assert.equal(matchesAnyGlob("packages/app/fixture.test.ts", ["**/*.test.ts"]), true);
  assert.equal(matchesAnyGlob("src/intentional-obfuscation.ts", ["src/intentional-obfuscation.ts"]), true);
});
