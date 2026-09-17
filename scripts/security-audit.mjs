import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? path.join(process.cwd(), "out"));
const prohibited = [
  { name: "process or filesystem module import", pattern: /require\s*\(\s*["'](?:node:)?(?:child_process|fs|fs\/promises)["']\s*\)/ },
  { name: "network module import", pattern: /require\s*\(\s*["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram)["']\s*\)/ },
  { name: "terminal creation", pattern: /\.createTerminal\s*\(/ },
  { name: "task execution", pattern: /\.executeTask\s*\(/ },
  { name: "terminal command dispatch", pattern: /workbench\.action\.terminal/ },
  { name: "global network request", pattern: /globalThis\.fetch\s*\(|\bfetch\s*\(\s*["'`]/ },
  { name: "socket construction", pattern: /new\s+(?:WebSocket|EventSource)\s*\(/ },
  { name: "native process binding", pattern: /process\.binding\s*\(/ }
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) result.push(target);
  }
  return result;
}

const failures = [];
for (const file of await files(root)) {
  if (file.includes(`${path.sep}test${path.sep}`)) continue;
  const source = await readFile(file, "utf8");
  for (const check of prohibited) {
    if (check.pattern.test(source)) failures.push(`${path.relative(root, file)}: ${check.name}`);
  }
}

if (failures.length > 0) {
  console.error("Codebase Guard runtime security audit failed:\n" + failures.map(item => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Runtime security audit passed: no prohibited process, terminal, filesystem-module, or network APIs found in packaged JavaScript.");
}
