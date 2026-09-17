# Codebase Guard

[![CI](https://github.com/mh-jsx/codebase-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/mh-jsx/codebase-guard/actions/workflows/ci.yml)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/mh-jsx.frontend-guard)](https://marketplace.visualstudio.com/items?itemName=mh-jsx.frontend-guard)
[![Open VSX](https://img.shields.io/open-vsx/v/mh-jsx/frontend-guard)](https://open-vsx.org/extension/mh-jsx/frontend-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-34d399.svg)](LICENSE)

Codebase Guard checks an opened codebase for suspicious code and risky project configuration **without running anything**. It works across JavaScript and TypeScript projects, PHP and Laravel applications, Composer packages, Python, Ruby, shell scripts, CI files, editor tasks, containers, and common framework configuration.

It supports VS Code Restricted Mode: **you do not need to trust a repository to scan it**.

Codebase Guard is open source under the MIT License. Its scanner runs locally,
does not execute project code, and does not send repository data anywhere.

## Safety boundary

At runtime Codebase Guard:

- reads workspace files through `vscode.workspace.fs`;
- never launches processes, terminals, tasks, Git, package managers, hooks, scripts, builds, or external binaries;
- never imports Node filesystem, process-launch, or network modules;
- never sends code, paths, hashes, telemetry, or findings over a network;
- never changes, deletes, quarantines, stages, commits, or pushes repository files;
- never writes into the repository; it only saves a report when requested and stores explicit allowlist/skip choices in VS Code user or workspace state.

This is a local developer safety layer, not a replacement for GitHub CI, Semgrep, CodeQL, secret scanning, EDR, code review, or incident response.

## What it checks

- Known indicators from the referenced obfuscated `postcss.config.mjs` incident.
- Meaningful combinations of obfuscated identifiers, extremely long lines, dynamic execution, process launch, active network/download primitives, runtime decoders, high-entropy strings, and config-file context. Ordinary URLs, application fetches, and function declarations are not findings by themselves.
- Hidden executable-looking content appended after a normal config export and a large whitespace gap.
- Suspicious npm and Composer scripts that may run during install, update, packaging, or project setup.
- Non-registry npm dependency sources.
- PHP execution, download, and decoding combinations in Laravel and other PHP codebases.
- Common project files such as `composer.json`, `artisan`, Laravel `config/` and `routes/`, `pyproject.toml`, `requirements*.txt`, `Pipfile`, `Gemfile`, `Cargo.toml`, `go.mod`, Maven/Gradle files, Docker files, and framework configs.
- Download-and-execute chains in shell, PowerShell, Git hooks, and VS Code task/debug files.
- Every VS Code task using `runOn: "folderOpen"`, with Critical severity when its command or dependency chain downloads and executes content, establishes persistence, or performs destructive deletion.
- Repository settings that enable automatic tasks, disable both word wrapping and the minimap, or use extreme task indentation to conceal content beyond the visible editor edge.
- Potentially exposed `.env` files when a simple local ignore-rule check finds no match (worded as a prompt to verify with Git, not a claim that the file is tracked).
- Oversized security-sensitive configs, which are reported even when content is not read.

The UI uses three actionable severities:

- **Critical** — known IOC or strong malicious/obfuscated combination. Do not execute the repository.
- **High** — risky behavior in an execution-sensitive context that needs prompt review.
- **Review** — a single weak signal or unusual configuration that may be legitimate.

Scores organize warnings by urgency. A warning is a clue to review, not proof that a file is malicious.

## Commands

- `Codebase Guard: Scan Workspace`
- `Codebase Guard: Scan Current File`
- `Codebase Guard: Show Findings`
- `Codebase Guard: Export JSON Report`
- `Codebase Guard: Manage Skipped Files and Folders`
- `Codebase Guard: Skip This File or Parent Folder…`

The Codebase Guard control center keeps **Scan workspace / Scan again** as its single main action. Findings appear in compact cards with named, always-visible actions to open the file, hide the reviewed alert, skip the file, or skip a parent folder. A separate current-location panel can scan or skip the active file and skip its parent folder. The skipped-items manager remains visible with its current count.

**Live** scans on open and rechecks only changed relevant files through one bounded queue. **On open** performs the startup scan without leaving change monitoring active. **Manual** runs nothing in the background while keeping workspace and current-file commands available. Findings also appear in the Problems panel and status bar.

Critical findings produce at most one summarized popup per workspace scan or changed-file batch. Additional Critical findings update the persistent Control Center, Problems panel, finding tree, and status bar without creating a queue of duplicate notifications.

Startup discovery prioritizes editor automation and other security-sensitive configuration. Remaining files are read with at most two concurrent workers. Large change bursts are deduplicated by path, so a checkout that reports the same file repeatedly produces one pending recheck for its latest state rather than one timer per event.

## Settings and Restricted Mode

The existing `frontendGuard.*` setting names remain unchanged so updates do not break saved settings. While a workspace is untrusted, Codebase Guard reads only user/default values and ignores repository-controlled workspace values.

The finding row provides two explicit actions: hide only the reviewed finding fingerprint in **User settings**, or skip its exact file or any parent folder in the opened codebase. Folder choices are derived directly from the finding path, so no Finder dialog or full-codebase picker is required. Critical findings require a deliberate modal confirmation before either action can hide them.

Default discovery excludes generated/dependency areas such as `node_modules`, `.git` (except `.git/hooks`), `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `vendor`, and caches. Use the folder action beside a finding to skip its file or choose any ancestor folder, or use **Manage skipped items** in the Control Center to restore and manually manage exclusions. These selections apply only to the opened codebase and are stored in VS Code/Cursor workspace state, outside the repository, so an untrusted repository cannot configure its own hiding rules. Add exclusions cautiously: broad exclusions reduce coverage.

## Install

### VS Code

1. Open Extensions in VS Code.
2. Search for **Codebase Guard**.
3. Confirm the publisher is `mh-jsx` and the extension ID is
   `mh-jsx.frontend-guard`.
4. Select **Install**.

You can also install it from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=mh-jsx.frontend-guard).

### Cursor

Codebase Guard is distributed publicly through Open VSX, the extension registry used by Cursor. After the public listing is available:

1. Open Extensions in Cursor.
2. Search for **Codebase Guard**.
3. Confirm the publisher is `mh-jsx` and the extension ID is `mh-jsx.frontend-guard`.
4. Select **Install**.

Cursor may hold a newly published version for marketplace security scanning before it appears in search.

For release testing, install `codebase-guard-0.1.7.vsix` through
**Extensions > … > Install from VSIX…**, then reload Cursor.

## Development

The installed extension never invokes development tools. Building the extension itself uses Node, TypeScript, tests, and `vsce` **inside this extension project only**:

```sh
npm ci
npm test
npm run security:audit
npm run package
```

Use Node.js 22. The packaged VSIX is written to
`release/codebase-guard-0.1.7.vsix`.

Before proposing a scanner rule, UI change, or documentation correction, read
[CONTRIBUTING.md](CONTRIBUTING.md). Contributions must preserve the runtime
boundary: no project execution, process launching, direct Node filesystem
access, network access, telemetry, or automatic workspace writes.

## Issues and security reports

- [Report a bug](https://github.com/mh-jsx/codebase-guard/issues/new?template=bug-report.yml)
- [Report a false positive](https://github.com/mh-jsx/codebase-guard/issues/new?template=false-positive.yml)
- [Request a feature](https://github.com/mh-jsx/codebase-guard/issues/new?template=feature-request.yml)
- [Privately report a vulnerability](https://github.com/mh-jsx/codebase-guard/security/advisories/new)

Never post credentials, proprietary source code, or unredacted findings in a
public issue. See [SECURITY.md](SECURITY.md) and [SUPPORT.md](SUPPORT.md).

## Remote workspaces

Analysis runs entirely inside the active VS Code extension environment and Codebase Guard creates no network connection. For local codebases this is local. With Remote SSH, WSL, Dev Containers, or Codespaces, VS Code may run this workspace extension in the remote workspace extension host.

See [SECURITY.md](SECURITY.md) and [docs/RULES.md](docs/RULES.md) for the threat model, limitations, and rule behavior.

## License

Codebase Guard is available under the [MIT License](LICENSE).
