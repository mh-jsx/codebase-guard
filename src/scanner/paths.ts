const SOURCE_EXTENSIONS = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "json", "jsonc",
  "py", "pyw", "sh", "bash", "zsh", "fish", "ps1", "psm1", "psd1", "rb",
  "php", "pl", "lua", "go", "rs", "java", "kt", "kts", "cs", "fs", "fsx",
  "yml", "yaml", "toml", "ini", "conf", "config", "xml", "gradle", "properties",
  "env", "service", "desktop", "command", "bat", "cmd"
]);

const CONFIG_NAMES = /^(?:package\.json$|composer\.json$|pyproject\.toml$|requirements(?:[-.][\w-]+)?\.txt$|pipfile$|gemfile$|cargo\.toml$|go\.mod$|pom\.xml$|build\.gradle(?:\.kts)?$|artisan$|rakefile$|manage\.py$|postcss\.config\.|vite\.config\.|next\.config\.|nuxt\.config\.|webpack\.config\.|rollup\.config\.|tailwind\.config\.|eslint\.config\.|babel\.config\.|jest\.config\.|vitest\.config\.|playwright\.config\.|cypress\.config\.|lint-staged\.config\.|commitlint\.config\.|pnpmfile\.|phpunit(?:\.xml(?:\.dist)?)?$|\.npmrc$|\.yarnrc(?:\.yml)?$|\.npm-init\.js$|dockerfile$|docker-compose\.ya?ml$|makefile$|lefthook\.ya?ml$)/i;

const FRAMEWORK_CONFIG_PATH = /(?:^|\/)(?:config\/|bootstrap\/app\.php$|routes\/[^/]+\.php$|app\/console\/kernel\.php$|src\/main\/resources\/application\.(?:ya?ml|properties)$|[^/]+\/settings\.py$)/i;

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function isSensitiveConfig(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  const name = basename(normalized);
  return CONFIG_NAMES.test(name)
    || FRAMEWORK_CONFIG_PATH.test(normalized)
    || normalized.startsWith(".vscode/")
    || normalized.includes("/.vscode/")
    || normalized.startsWith(".devcontainer/")
    || normalized.includes("/.devcontainer/")
    || normalized.startsWith(".github/workflows/")
    || normalized.includes("/.github/workflows/")
    || normalized.startsWith(".git/hooks/")
    || normalized.includes("/.git/hooks/");
}

export function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.");
}

export function isRelevantFile(path: string): boolean {
  const normalized = normalizePath(path);
  const name = basename(normalized);
  if (isSensitiveConfig(normalized) || isEnvironmentFile(normalized)) return true;
  if (/^(?:makefile|dockerfile)$/i.test(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && SOURCE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) return true;
  return normalized.includes("/.git/hooks/") || normalized.startsWith(".git/hooks/");
}

export function priorityForPath(path: string): number {
  const normalized = normalizePath(path).toLowerCase();
  if (/postcss\.config\.|package\.json$|composer\.json$/.test(normalized)) return 0;
  if (normalized.includes(".vscode/") || normalized.includes(".git/hooks/")) return 1;
  if (isSensitiveConfig(normalized)) return 2;
  if (normalized.includes("/scripts/") || normalized.startsWith("scripts/")) return 3;
  return 10;
}
