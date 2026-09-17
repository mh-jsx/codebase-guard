import { normalizePath } from "../scanner/paths";

export function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === "*" && next === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return globs.some(glob => {
    try { return globToRegExp(glob).test(normalized); } catch { return false; }
  });
}
