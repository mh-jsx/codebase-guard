import * as vscode from "vscode";
import { isRelevantFile, priorityForPath } from "../scanner/paths";
import { matchesAnyGlob } from "./glob";

const DEFAULT_EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/coverage/**,**/.next/**,**/.nuxt/**,**/vendor/**,**/target/**,**/.cache/**,**/.turbo/**}";
const PRIORITY_CONFIGS = "**/{.vscode/tasks.json,.vscode/settings.json,.vscode/launch.json,.devcontainer/devcontainer.json,package.json,composer.json,postcss.config.*,pyproject.toml}";

export interface DiscoveryResult {
  readonly uris: readonly vscode.Uri[];
  readonly truncated: boolean;
}

export function relativePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return uri.path.replace(/^\//, "");
  const root = folder.uri.path.endsWith("/") ? folder.uri.path : `${folder.uri.path}/`;
  const local = uri.path.startsWith(root) ? uri.path.slice(root.length) : uri.path.replace(/^\//, "");
  return local.replace(/\\/g, "/");
}

export async function discoverFiles(exclusions: readonly string[], maximum: number): Promise<DiscoveryResult> {
  const [priority, found, hooks] = await Promise.all([
    vscode.workspace.findFiles(PRIORITY_CONFIGS, DEFAULT_EXCLUDE, 2_000),
    vscode.workspace.findFiles("**/*", DEFAULT_EXCLUDE, maximum + 1),
    vscode.workspace.findFiles("**/.git/hooks/*", null, 501)
  ]);
  const unique = new Map<string, vscode.Uri>();
  for (const uri of [...priority, ...found, ...hooks]) {
    const path = relativePath(uri);
    if (!isRelevantFile(path) || matchesAnyGlob(path, exclusions)) continue;
    unique.set(uri.toString(), uri);
  }
  const sorted = [...unique.values()].sort((left, right) => {
    const leftPath = relativePath(left);
    const rightPath = relativePath(right);
    return priorityForPath(leftPath) - priorityForPath(rightPath) || leftPath.localeCompare(rightPath);
  });
  return {
    uris: sorted.slice(0, maximum),
    truncated: found.length > maximum || hooks.length > 500 || sorted.length > maximum
  };
}

export async function environmentFilePotentiallyUnignored(uri: vscode.Uri): Promise<boolean> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return true;
  const texts: string[] = [];
  for (const parts of [[".gitignore"], [".git", "info", "exclude"]]) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, ...parts));
      texts.push(new TextDecoder().decode(bytes));
    } catch {
      // A missing ignore file is normal.
    }
  }
  const path = relativePath(uri);
  const name = path.slice(path.lastIndexOf("/") + 1);
  for (const text of texts) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const normalized = line.replace(/^\//, "");
      if (normalized === name || normalized === path || normalized === ".env*" || normalized === "*.env") return false;
      if (normalized.endsWith("/**") && path.startsWith(normalized.slice(0, -3))) return false;
    }
  }
  return true;
}
