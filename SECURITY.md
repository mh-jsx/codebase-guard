# Security model

## Supported versions

| Version | Supported |
| --- | --- |
| Latest `0.1.x` release | Yes |
| Older releases | No |

## Intended use

Open an unfamiliar codebase in VS Code/Cursor Restricted Mode, let Codebase Guard check it, review every Critical or High finding, and only then decide whether it is appropriate to run project code.

## Guarantees designed into this version

- No `child_process`, terminal creation, task execution, shell command, external binary, package-manager invocation, Git command, hook execution, or workspace-code execution.
- No HTTP, socket, DNS, telemetry, update check, API key, remote service, or repository-data transmission.
- Workspace content is read with VS Code APIs. No Node `fs` import exists in runtime output.
- No automatic workspace edits. JSON export is a deliberate user command and save-dialog choice.
- Security settings are restricted, and code also ignores workspace/folder values while the workspace is untrusted.
- Critical alert history is notification suppression only. Allowlisting is a separate, explicit User setting.
- Large security-sensitive configs are never silently absent: they receive a finding when the safe read limit is exceeded. VS Code and development-container execution configuration is High; other sensitive configuration is Review.
- Live change monitoring uses VS Code's existing workspace event stream, one coalescing priority queue, and a two-reader ceiling. On-open and Manual modes dispose all change-monitor subscriptions.

The build has a compiled-output audit that rejects process/filesystem module imports, network module imports, terminal/task APIs, terminal command dispatch, and direct network calls.

## Limitations

- Static heuristics can produce false positives and false negatives.
- Codebase Guard does not prove that a codebase is safe.
- The MVP does not parse every programming language or emulate control flow.
- The `.env` ignore check implements a conservative subset of Git ignore behavior and does not inspect the Git index; always verify with Git before committing.
- Default exclusions and file-count/file-size limits trade completeness for responsiveness. Attackers may hide content in excluded, unsupported, binary, or oversized files. The UI marks cancelled, truncated, or unreadable scans as Partial.
- Detection is not prevention. In a trusted workspace, VS Code may start an already-approved folder-open task before or while extensions activate. Keep unfamiliar repositories in Restricted Mode and keep automatic tasks disabled.
- VS Code may run workspace extensions remotely for Remote/WSL/Container/Codespaces workspaces.

## Reporting a security issue

Do not open a public issue for a vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/mh-jsx/codebase-guard/security/advisories/new)
so the maintainer can investigate without exposing users.

Include the affected version, impact, reproduction steps, and the smallest safe
sample possible. Redact credentials, personal information, absolute paths, and
proprietary repository contents. A false positive or ordinary scanner bug that
does not expose a security weakness can use the public issue forms.

Codebase Guard is maintained as a small open-source project. Reports will be
acknowledged as capacity permits; no response-time guarantee is made.
