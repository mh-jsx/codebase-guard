import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as Record<string, any>;

test("extension explicitly supports untrusted workspaces", () => {
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
});

test("all security-relevant settings are restricted in untrusted workspaces", () => {
  const restricted = new Set(manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations as string[]);
  for (const key of ["enabled", "automaticScanMode", "exclude", "allowlist", "maxFileSizeBytes", "maxFiles"]) {
    assert.equal(restricted.has(`frontendGuard.${key}`), true, `${key} must be restricted`);
  }
});

test("automatic scanning has live, open-only, and manual modes", () => {
  const mode = manifest.contributes?.configuration?.properties?.["frontendGuard.automaticScanMode"];
  assert.deepEqual(mode?.enum, ["live", "open", "manual"]);
  assert.equal(mode?.default, "live");
});

test("extension has no runtime dependencies", () => {
  assert.equal(manifest.dependencies, undefined);
});

test("sidebar control center is registered as the primary Codebase Guard view", () => {
  const views = manifest.contributes?.views?.frontendGuard as Array<{ id?: string; type?: string }>;
  assert.equal(views?.[0]?.id, "frontendGuard.controlCenter");
  assert.equal(views?.[0]?.type, "webview");
  assert.equal(manifest.activationEvents?.includes("onView:frontendGuard.controlCenter"), true);
});

test("marketplace branding includes the framework-neutral name and logo", () => {
  assert.equal(manifest.displayName, "Codebase Guard");
  assert.equal(manifest.icon, "media/logo.png");
  assert.match(manifest.description as string, /without running/i);
});

test("open-source metadata points to the canonical public repository", () => {
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.repository?.url, "https://github.com/mh-jsx/codebase-guard.git");
  assert.equal(manifest.homepage, "https://github.com/mh-jsx/codebase-guard#readme");
  assert.equal(manifest.bugs?.url, "https://github.com/mh-jsx/codebase-guard/issues");
});

test("file and folder exclusions can be managed from the extension UI", () => {
  const commands = manifest.contributes?.commands as Array<{ command?: string }>;
  assert.equal(commands.some(item => item.command === "frontendGuard.configureExclusions"), true);
  assert.equal(commands.some(item => item.command === "frontendGuard.skipFindingSource"), true);

  const menus = manifest.contributes?.menus?.["view/item/context"] as Array<{ command?: string; when?: string }>;
  const findingSkip = menus.find(item => item.command === "frontendGuard.skipFindingSource");
  assert.equal(findingSkip?.when?.includes("viewItem == frontendGuard.finding"), true);
});
