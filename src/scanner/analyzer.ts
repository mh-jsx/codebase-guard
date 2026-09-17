import { hashText, sha256 } from "./hash";
import { KNOWN_INDICATORS } from "./indicators";
import { isEnvironmentFile, isSensitiveConfig, normalizePath } from "./paths";
import type { AnalysisResult, AnalyzeInput, Finding, Position, Severity } from "./types";

interface Signal {
  readonly kind: "long-line" | "obfuscation" | "execution" | "network-action" | "url" | "decoder" | "blob" | "context";
  readonly label: string;
  readonly score: number;
  readonly index: number;
  readonly length: number;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function isLikelyBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  if (limit === 0) return false;
  let suspicious = 0;
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / limit > 0.15;
}

function positionAt(text: string, target: number): Position {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < target; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: target - lineStart };
}

function evidenceAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 35);
  const end = Math.min(text.length, index + Math.max(length, 1) + 65);
  return text.slice(start, end).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 160);
}

function severityForScore(score: number): Severity {
  if (score >= 70) return "critical";
  if (score >= 30) return "high";
  return "review";
}

function finding(
  relativePath: string,
  contentHash: string,
  text: string,
  ruleId: string,
  title: string,
  description: string,
  score: number,
  index: number,
  length: number,
  forcedSeverity?: Severity
): Finding {
  const evidence = evidenceAt(text, index, length);
  const fingerprint = hashText([ruleId, normalizePath(relativePath), evidence, contentHash].join("\u0000"));
  const severity = forcedSeverity ?? severityForScore(score);
  const confidence = severity === "critical" ? "high" : severity === "high" ? "medium" : "low";
  return {
    ruleId,
    title,
    description,
    severity,
    confidence,
    score,
    relativePath: normalizePath(relativePath),
    position: positionAt(text, index),
    length: Math.max(1, length),
    evidence,
    fingerprint
  };
}

function firstMatch(text: string, expression: RegExp): RegExpExecArray | undefined {
  expression.lastIndex = 0;
  return expression.exec(text) ?? undefined;
}

function maximumLine(text: string): { length: number; start: number } {
  let currentStart = 0;
  let maximumStart = 0;
  let maximumLength = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text.charCodeAt(index) === 10) {
      const length = index - currentStart;
      if (length > maximumLength) {
        maximumLength = length;
        maximumStart = currentStart;
      }
      currentStart = index + 1;
    }
  }
  return { length: maximumLength, start: maximumStart };
}

function entropy(value: string): number {
  if (value.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  let result = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function collectHeuristicSignals(path: string, text: string): Signal[] {
  const signals: Signal[] = [];
  const longLine = maximumLine(text);
  if (longLine.length >= 12000) {
    signals.push({ kind: "long-line", label: `very long line (${longLine.length.toLocaleString()} characters)`, score: 25, index: longLine.start, length: 1 });
  }

  const obfuscated = Array.from(text.matchAll(/\b_0x[a-f\d]{4,}\b/gi));
  if (obfuscated.length >= 8) {
    signals.push({ kind: "obfuscation", label: `${obfuscated.length} obfuscated-style identifiers`, score: 25, index: obfuscated[0].index ?? 0, length: obfuscated[0][0].length });
  }

  const processExecution = firstMatch(text, /\b(?:eval\s*\(|child_process|\.exec(?:File|Sync)?\s*\(|\.spawn(?:Sync)?\s*\(|subprocess\.|os\.system\s*\(|shell_exec\s*\(|passthru\s*\(|proc_open\s*\(|popen\s*\(|system\s*\(|EncodedCommand\b)/i);
  const functionConstructor = firstMatch(text, /\b(?:new\s+)?Function\s*\(/);
  const execution = !processExecution
    ? functionConstructor
    : !functionConstructor || processExecution.index <= functionConstructor.index
      ? processExecution
      : functionConstructor;
  if (execution) signals.push({ kind: "execution", label: "dynamic execution or process-launch primitive", score: 20, index: execution.index, length: execution[0].length });

  const networkAction = firstMatch(text, /(?:\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bcurl\s+|\bcurl_exec\s*\(|\bfile_get_contents\s*\(\s*["']https?:|\bwget\s+|Invoke-WebRequest|DownloadString|\b(?:net|http|https)\.(?:request|get)\s*\()/i);
  if (networkAction) {
    signals.push({ kind: "network-action", label: "network or download primitive", score: 20, index: networkAction.index, length: networkAction[0].length });
  } else {
    const url = firstMatch(text, /https?:\/\//i);
    if (url) signals.push({ kind: "url", label: "URL reference", score: 5, index: url.index, length: url[0].length });
  }

  const decoderMatch = firstMatch(text, /(?:Buffer\.from\s*\([^)]{0,120}["']base64["']|\batob\s*\(|\bbase64_decode\s*\(|\bgzinflate\s*\(|\bhex2bin\s*\(|fromCharCode\s*\(|-EncodedCommand\b|base64\s+(?:-d|--decode)|(?:\\x[\da-f]{2}){12,}|(?:\\u[\da-f]{4}){10,})/i);
  if (decoderMatch) signals.push({ kind: "decoder", label: "encoded payload or runtime decoder", score: 15, index: decoderMatch.index, length: decoderMatch[0].length });

  const blob = firstMatch(text, /[A-Za-z\d+/]{256,}={0,2}/g);
  const blobPrefix = blob ? text.slice(Math.max(0, blob.index - 100), blob.index) : "";
  const embeddedMedia = /data:(?:image|audio|video|font)\/[\w.+-]+;base64,$/i.test(blobPrefix);
  if (blob && !embeddedMedia && entropy(blob[0]) >= 4.5) {
    signals.push({ kind: "blob", label: "long high-entropy encoded string", score: 15, index: blob.index, length: Math.min(blob[0].length, 32) });
  }

  if (isSensitiveConfig(path) && signals.length > 0) {
    const index = signals[0].index;
    signals.push({ kind: "context", label: "security-sensitive configuration context", score: 15, index, length: 1 });
  }
  return signals;
}

function shouldReportHeuristics(signals: readonly Signal[]): boolean {
  const kinds = new Set(signals.map(signal => signal.kind));
  if (kinds.has("execution") || kinds.has("obfuscation")) return true;
  if (kinds.has("context") && kinds.has("network-action")) return true;
  return signals.reduce((total, signal) => total + signal.score, 0) >= 40;
}

function isDeclarativeSemgrepConfig(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return /(?:^|\/)\.semgrep\.ya?ml$/.test(normalized);
}

function parseJsonc(text: string): unknown {
  const characters = [...text];
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const next = characters[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      else characters[index] = " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        characters[index] = " ";
        characters[index + 1] = " ";
        blockComment = false;
        index += 1;
      } else if (character !== "\n" && character !== "\r") {
        characters[index] = " ";
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "/" && next === "/") {
      characters[index] = " ";
      characters[index + 1] = " ";
      lineComment = true;
      index += 1;
    } else if (character === "/" && next === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      blockComment = true;
      index += 1;
    }
  }
  const withoutComments = [...characters.join("").replace(/^\uFEFF/, " ")];
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== ",") continue;
    let lookahead = index + 1;
    while (/\s/.test(withoutComments[lookahead] ?? "")) lookahead += 1;
    if (withoutComments[lookahead] === "}" || withoutComments[lookahead] === "]") withoutComments[index] = " ";
  }
  return JSON.parse(withoutComments.join(""));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function commandText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(commandText).join(" ");
  const object = record(value);
  return object ? Object.values(object).map(commandText).join(" ") : "";
}

function dangerousAutomaticCommand(value: string): boolean {
  const network = /(?:https?:\/\/|\bcurl\b|\bwget\b|Invoke-WebRequest|DownloadString)/i.test(value);
  const execution = /(?:\|\s*(?:sudo\s+)?(?:sh|bash|zsh|powershell|pwsh)\b|\b(?:bash|sh|zsh)\s+-c\b|\b(?:node|python\d*|php)\s+(?:-e|-c|-r)\b|Invoke-Expression|\biex\b|-EncodedCommand\b)/i.test(value);
  const destructive = /(?:\brm\s+-[^\r\n]*r[^\r\n]*f\b|\b(?:del|rmdir)\s+\/(?:s|q)\b|Remove-Item[^\r\n]{0,120}-Recurse)/i.test(value);
  const persistence = /(?:\blaunchctl\b|\bcrontab\b|\.zshrc\b|\.bashrc\b|npm(?:\.cmd)?\b[^\r\n]{0,120}(?:replace|wrapper|alias))/i.test(value);
  return (network && execution) || destructive || (network && persistence);
}

function vscodeConfigurationFindings(path: string, text: string, contentHash: string): Finding[] {
  const normalized = normalizePath(path).toLowerCase();
  const tasksFile = normalized.endsWith(".vscode/tasks.json");
  const settingsFile = normalized.endsWith(".vscode/settings.json");
  if (!tasksFile && !settingsFile) return [];

  let parsed: unknown;
  try { parsed = parseJsonc(text); } catch { parsed = undefined; }
  const root = record(parsed);
  const results: Finding[] = [];

  if (tasksFile) {
    const tasks = Array.isArray(root?.tasks) ? root.tasks : [];
    const byLabel = new Map<string, Record<string, unknown>>();
    for (const item of tasks) {
      const task = record(item);
      if (task && typeof task.label === "string") byLabel.set(task.label, task);
    }
    for (const item of tasks) {
      const task = record(item);
      const runOptions = record(task?.runOptions);
      if (!task || runOptions?.runOn !== "folderOpen") continue;
      const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn : typeof task.dependsOn === "string" ? [task.dependsOn] : [];
      const dependencyCommands = dependencies.map(label => typeof label === "string" ? commandText(byLabel.get(label)) : "").join(" ");
      const completeCommand = `${commandText(task.command)} ${commandText(task.args)} ${commandText(task.options)} ${dependencyCommands}`;
      const index = Math.max(0, text.indexOf("folderOpen"));
      const dangerous = dangerousAutomaticCommand(completeCommand);
      results.push(finding(
        path,
        contentHash,
        text,
        dangerous ? "FG-VSCODE-AUTOEXEC" : "FG-VSCODE-FOLDER-OPEN",
        dangerous ? "Dangerous task configured to run when the folder opens" : "Task configured to run when the folder opens",
        dangerous
          ? "This task can start automatically and contains a download, execution, persistence, or destructive command chain. Keep the workspace untrusted and do not allow automatic tasks."
          : "VS Code can start this task automatically after permission is granted. Review the task before trusting or running the codebase.",
        dangerous ? 90 : 45,
        index,
        "folderOpen".length,
        dangerous ? "critical" : "high"
      ));
    }

    // Preserve detection when malformed JSONC prevents structured parsing.
    if (tasks.length === 0) {
      const fallback = firstMatch(text, /["']runOn["']\s*:\s*["']folderOpen["']/i);
      if (fallback) {
        results.push(finding(
          path, contentHash, text, "FG-VSCODE-FOLDER-OPEN", "Task configured to run when the folder opens",
          "The file declares a folder-open task but could not be parsed completely. Review it before trusting the codebase.",
          45, fallback.index, fallback[0].length, "high"
        ));
      }
    }

    const hiddenLine = firstMatch(text, /^[ \t]{256,}\S/m);
    if (hiddenLine) {
      results.push(finding(
        path, contentHash, text, "FG-VSCODE-CONCEALMENT", "Task content pushed far beyond the visible editor edge",
        "A line begins after an extreme horizontal whitespace gap. This can conceal a command when word wrapping is disabled.",
        45, hiddenLine.index, Math.min(hiddenLine[0].length, 256), "high"
      ));
    }
  }

  if (settingsFile) {
    const automaticTasks = root?.["task.allowAutomaticTasks"];
    if (automaticTasks === "on") {
      const index = Math.max(0, text.indexOf("task.allowAutomaticTasks"));
      results.push(finding(
        path, contentHash, text, "FG-VSCODE-AUTOTASK-ON", "Workspace enables automatic folder-open tasks",
        "This repository setting allows tasks with runOn: folderOpen to start automatically in a trusted workspace.",
        50, index, "task.allowAutomaticTasks".length, "high"
      ));
    }
    const disablesWrap = root?.["editor.wordWrap"] === "off";
    const minimap = record(root?.["editor.minimap"]);
    const disablesMinimap = root?.["editor.minimap.enabled"] === false || minimap?.enabled === false;
    if (disablesWrap && disablesMinimap) {
      const index = Math.max(0, text.indexOf("editor.wordWrap"));
      results.push(finding(
        path, contentHash, text, "FG-VSCODE-CONCEALMENT", "Workspace settings reduce visibility of hidden commands",
        "This repository disables both word wrapping and the minimap, which can make extremely indented task commands harder to notice.",
        35, index, "editor.wordWrap".length, "high"
      ));
    }
  }

  return results;
}

function hiddenAppendFinding(path: string, text: string, contentHash: string): Finding | undefined {
  if (!isSensitiveConfig(path)) return undefined;
  const expression = /(?:export\s+default|module\.exports\s*=)[\s\S]{0,4000}?[;}][ \t]{1024,}(?=(?:const|let|var|function|\(?\s*async|eval|[\w$]+\s*=))/g;
  const match = firstMatch(text, expression);
  if (!match) return undefined;
  const tailIndex = match.index + match[0].length;
  return finding(
    path, contentHash, text, "FG-CONFIG-HIDDEN-APPEND", "Code hidden after configuration content",
    "More executable-looking code appears after a large hidden whitespace gap.",
    75, tailIndex, 1, "critical"
  );
}

function packageFindings(path: string, text: string, contentHash: string): Finding[] {
  if (!normalizePath(path).toLowerCase().endsWith("package.json")) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const results: Finding[] = [];
  const scripts = record.scripts;
  if (scripts && typeof scripts === "object") {
    for (const name of ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]) {
      const command = (scripts as Record<string, unknown>)[name];
      if (typeof command !== "string") continue;
      const dangerous = /(?:https?:\/\/|\bcurl\b|\bwget\b|powershell|pwsh|python\s+-c|node\s+-e|(?:bash|sh)\s+-c|base64|\beval\b|\|\s*(?:bash|sh|powershell|pwsh)\b)/i.test(command);
      const index = Math.max(0, text.indexOf(command));
      results.push(finding(
        path, contentHash, text, "FG-NPM-LIFECYCLE", `Automatic npm script: ${name}`,
        dangerous
          ? "This script can run automatically and includes download, shell, interpreter, or decoding behavior."
          : "This script can run automatically during install or packaging. Review it before continuing.",
        dangerous ? 75 : 15, index, command.length, dangerous ? "critical" : "review"
      ));
    }
  }

  for (const sectionName of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const section = record[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const [name, value] of Object.entries(section as Record<string, unknown>)) {
      if (typeof value !== "string" || !/^(?:https?:|git\+|git:|git@|file:)/i.test(value)) continue;
      const index = Math.max(0, text.indexOf(value));
      results.push(finding(
        path, contentHash, text, "FG-NPM-NONREGISTRY", `Non-registry dependency source: ${name}`,
        "This dependency comes from a URL, Git repository, or local path instead of the normal package registry.",
        10, index, value.length, "review"
      ));
    }
  }
  return results;
}

function composerFindings(path: string, text: string, contentHash: string): Finding[] {
  if (!normalizePath(path).toLowerCase().endsWith("composer.json")) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (!parsed || typeof parsed !== "object") return [];
  const scripts = (parsed as Record<string, unknown>).scripts;
  if (!scripts || typeof scripts !== "object") return [];

  const automaticEvents = new Set([
    "pre-install-cmd", "post-install-cmd", "pre-update-cmd", "post-update-cmd",
    "pre-autoload-dump", "post-autoload-dump", "post-root-package-install", "post-create-project-cmd"
  ]);
  const results: Finding[] = [];
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (!automaticEvents.has(name)) continue;
    const commands = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    for (const command of commands) {
      const dangerous = /(?:https?:\/\/|\bcurl\b|\bwget\b|powershell|pwsh|python\s+-c|php\s+-r|base64_decode|\beval\b|\|\s*(?:bash|sh|powershell|pwsh)\b)/i.test(command);
      const index = Math.max(0, text.indexOf(command));
      results.push(finding(
        path, contentHash, text, "FG-COMPOSER-SCRIPT", `Automatic Composer script: ${name}`,
        dangerous
          ? "This Composer event can run automatically and includes download, shell, interpreter, or decoding behavior."
          : "This Composer event can run automatically during install, update, or project setup. Review it before continuing.",
        dangerous ? 75 : 15, index, command.length, dangerous ? "critical" : "review"
      ));
    }
  }
  return results;
}

function directDangerFinding(path: string, text: string, contentHash: string): Finding | undefined {
  const normalized = normalizePath(path).toLowerCase();
  let expression: RegExp | undefined;
  let ruleId = "";
  let title = "";
  let forcedSeverity: Severity = "critical";
  if (/\.ps(?:1|m1|d1)$/.test(normalized)) {
    expression = /(?:-EncodedCommand\b|Invoke-WebRequest[\s\S]{0,300}(?:Invoke-Expression|\biex\b)|DownloadString\s*\([^)]*\)[\s\S]{0,200}(?:Invoke-Expression|\biex\b))/i;
    ruleId = "FG-PS-ENCODED-DOWNLOAD";
    title = "PowerShell encoded/download execution chain";
  } else if (/\.(?:sh|bash|zsh|command)$/.test(normalized) || normalized.includes(".git/hooks/")) {
    expression = /(?:curl|wget)[^\r\n|]{0,500}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i;
    ruleId = "FG-SHELL-DOWNLOAD-EXEC";
    title = "Downloaded content piped into a shell";
  } else if (normalized.endsWith(".vscode/tasks.json") || normalized.endsWith(".vscode/launch.json")) {
    expression = /(?:curl|wget|powershell|pwsh|bash\s+-c|sh\s+-c|node\s+-e|python\s+-c)[\s\S]{0,500}(?:https?:\/\/|-EncodedCommand|\|\s*(?:sh|bash))/i;
    ruleId = "FG-VSCODE-DANGEROUS-AUTOMATION";
    title = "Suspicious command chain in editor automation configuration";
    forcedSeverity = "high";
  }
  if (!expression) return undefined;
  const match = firstMatch(text, expression);
  if (!match) return undefined;
  return finding(path, contentHash, text, ruleId, title, "Static text contains a download/decoding and execution chain in an executable context.", forcedSeverity === "critical" ? 80 : 55, match.index, match[0].length, forcedSeverity);
}

export function analyzeFile(input: AnalyzeInput): AnalysisResult {
  const contentHash = sha256(input.bytes);
  if (isLikelyBinary(input.bytes)) return { findings: [], binary: true, contentHash };
  const text = decoder.decode(input.bytes);
  const path = normalizePath(input.relativePath);
  const results: Finding[] = [];

  for (const indicator of KNOWN_INDICATORS) {
    const index = text.indexOf(indicator.value);
    if (index < 0) continue;
    results.push(finding(
      path, contentHash, text, indicator.id, "Known suspicious marker found",
      `This matches ${indicator.label}. Do not run the codebase until you review this file.`,
      100, index, indicator.value.length, "critical"
    ));
  }

  const vscodeResults = vscodeConfigurationFindings(path, text, contentHash);
  const direct = directDangerFinding(path, text, contentHash);
  if (direct && !vscodeResults.some(item => item.ruleId === "FG-VSCODE-AUTOEXEC")) results.push(direct);
  const hidden = hiddenAppendFinding(path, text, contentHash);
  if (hidden) results.push(hidden);
  results.push(...vscodeResults);
  results.push(...packageFindings(path, text, contentHash));
  results.push(...composerFindings(path, text, contentHash));

  const signals = isDeclarativeSemgrepConfig(path) ? [] : collectHeuristicSignals(path, text);
  if (shouldReportHeuristics(signals)) {
    const score = signals.reduce((total, signal) => total + signal.score, 0);
    const primary = signals.reduce((best, signal) => signal.score > best.score ? signal : best, signals[0]);
    results.push(finding(
      path, contentHash, text, "FG-HEUR-COMBINATION", "Suspicious code pattern",
      `Found: ${signals.map(signal => signal.label).join("; ")}. The file was read, not run.`,
      score, primary.index, primary.length
    ));
  }

  if (isEnvironmentFile(path) && input.envPotentiallyUnignored) {
    results.push(finding(
      path, contentHash, text, "FG-ENV-EXPOSURE", "Potential exposed environment file",
      "This environment file exists and Codebase Guard did not find a matching local ignore rule. Verify with Git before committing.",
      10, 0, 1, "review"
    ));
  }

  const unique = new Map<string, Finding>();
  for (const result of results) unique.set(result.fingerprint, result);
  return { findings: [...unique.values()], binary: false, contentHash };
}
