import { normalizePath } from "../scanner/paths";

export interface FindingExclusionChoice {
  readonly kind: "file" | "folder";
  readonly path: string;
  readonly pattern: string;
}

export function findingExclusionChoices(relativePath: string): readonly FindingExclusionChoice[] {
  const normalized = normalizePath(relativePath).replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return [];

  const choices: FindingExclusionChoice[] = [
    { kind: "file", path: normalized, pattern: normalized }
  ];
  for (let end = parts.length - 1; end > 0; end -= 1) {
    const path = parts.slice(0, end).join("/");
    choices.push({ kind: "folder", path, pattern: `${path}/**` });
  }
  return choices;
}
