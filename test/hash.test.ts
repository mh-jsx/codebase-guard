import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../src/scanner/hash";

test("SHA-256 fingerprints are stable", () => {
  assert.equal(sha256(new TextEncoder().encode("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
