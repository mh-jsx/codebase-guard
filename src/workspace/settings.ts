import * as vscode from "vscode";

export type AutomaticScanMode = "live" | "open" | "manual";

export interface GuardSettings {
  readonly enabled: boolean;
  readonly exclude: readonly string[];
  readonly allowlist: ReadonlySet<string>;
  readonly maxFileSizeBytes: number;
  readonly maxFiles: number;
  readonly automaticScanMode: AutomaticScanMode;
  readonly workspaceControlled: boolean;
}

let managedWorkspaceExclusions: readonly string[] = [];

function normalizeExclusions(exclusions: readonly string[]): readonly string[] {
  return exclusions
    .map(exclusion => exclusion.trim().replace(/\\/g, "/"))
    .filter((exclusion, index, values) => exclusion.length > 0 && values.indexOf(exclusion) === index);
}

function safeValue<T>(key: string, fallback: T): T {
  const configuration = vscode.workspace.getConfiguration("frontendGuard");
  const inspected = configuration.inspect<T>(key);
  if (!inspected) return fallback;
  if (!vscode.workspace.isTrusted) {
    return inspected.globalLanguageValue ?? inspected.globalValue ?? inspected.defaultLanguageValue ?? inspected.defaultValue ?? fallback;
  }
  return configuration.get<T>(key, fallback);
}

export function readSettings(): GuardSettings {
  const configuration = vscode.workspace.getConfiguration("frontendGuard");
  const keys = ["enabled", "automaticScanMode", "exclude", "allowlist", "maxFileSizeBytes", "maxFiles"] as const;
  const workspaceControlled = vscode.workspace.isTrusted && keys.some(key => {
    const inspected = configuration.inspect(key);
    return inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
  });
  const configuredExclusions = safeValue<readonly string[]>("exclude", []);
  const configuredMode = safeValue<AutomaticScanMode>("automaticScanMode", "live");
  return {
    enabled: safeValue("enabled", true),
    exclude: normalizeExclusions([...configuredExclusions, ...managedWorkspaceExclusions]),
    allowlist: new Set(safeValue<readonly string[]>("allowlist", [])),
    maxFileSizeBytes: safeValue("maxFileSizeBytes", 2 * 1024 * 1024),
    maxFiles: safeValue("maxFiles", 20000),
    automaticScanMode: configuredMode === "open" || configuredMode === "manual" ? configuredMode : "live",
    workspaceControlled
  };
}

export async function setGlobalAutomaticScanMode(mode: AutomaticScanMode): Promise<void> {
  await vscode.workspace.getConfiguration("frontendGuard").update("automaticScanMode", mode, vscode.ConfigurationTarget.Global);
}

export async function addGlobalAllowlistFingerprint(fingerprint: string): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("frontendGuard");
  const inspected = configuration.inspect<readonly string[]>("allowlist");
  const current = inspected?.globalValue ?? [];
  if (current.includes(fingerprint)) return;
  await configuration.update("allowlist", [...current, fingerprint], vscode.ConfigurationTarget.Global);
}

export function readManagedWorkspaceExclusions(): readonly string[] {
  return managedWorkspaceExclusions;
}

export function setManagedWorkspaceExclusions(exclusions: readonly string[]): readonly string[] {
  managedWorkspaceExclusions = normalizeExclusions(exclusions);
  return managedWorkspaceExclusions;
}
