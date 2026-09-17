# Contributing to Codebase Guard

Thanks for helping make unfamiliar codebases safer to inspect. Contributions
are welcome for detection rules, performance, editor UX, documentation, and
tests.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

- Search existing issues first.
- Use the false-positive form for a legitimate pattern that is being flagged.
- Remove credentials, personal information, absolute paths, and proprietary
  source code from examples.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Node.js 22
- npm
- VS Code 1.85 or newer, or a compatible Cursor version

Install and verify the project:

```sh
npm ci
npm test
npm run security:audit
npm run package
```

These commands are development tooling for this extension project. The
installed extension does not run them and never invokes project tooling in an
opened workspace.

## Non-negotiable runtime boundary

All runtime contributions must preserve these properties:

- analyze files statically without executing workspace code;
- use VS Code APIs, especially `vscode.workspace.fs`, for workspace reads;
- do not import Node filesystem, process-launch, or network modules;
- do not create terminals, execute tasks, launch Git, or invoke external tools;
- do not add telemetry or transmit code, paths, hashes, or findings;
- do not automatically edit, delete, quarantine, stage, commit, or push files;
- continue working in VS Code Restricted Mode.

The compiled-output security audit enforces part of this boundary. Reviewers
will reject changes that weaken it even when tests pass.

## Adding or changing a scanner rule

1. Document the threat behavior and why static evidence is meaningful.
2. Prefer combinations of strong signals over single common keywords.
3. Add or update a stable `FG-*` rule ID and document it in
   [docs/RULES.md](docs/RULES.md).
4. Add focused positive and negative tests. Test fixtures must be inert strings;
   never add a working malicious payload or executable specimen.
5. Explain likely false positives and the chosen Critical, High, or Review
   severity.
6. Run the full test and security-audit commands.

## Pull requests

Keep pull requests focused. Describe the user-visible behavior, security impact,
tests performed, and any limitations. Update the README, rules documentation,
and changelog when behavior or public configuration changes.

Contributions are licensed under the repository's [MIT License](LICENSE).
