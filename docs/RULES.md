# Rule reference

| Rule family | Meaning | Default result |
| --- | --- | --- |
| `FG-IOC-*` | Exact known incident indicator | Critical |
| `FG-CONFIG-HIDDEN-APPEND` | Large whitespace gap followed by executable-looking config tail | Critical |
| `FG-HEUR-COMBINATION` | Weighted obfuscation, execution, active network, encoding, long-line, entropy, and config-context signals | Review / High / Critical by combined score |
| `FG-NPM-LIFECYCLE` | npm lifecycle script; download/shell/decoder combinations score higher | Review or Critical |
| `FG-NPM-NONREGISTRY` | Direct URL, Git, or local dependency source | Review |
| `FG-PS-ENCODED-DOWNLOAD` | Encoded or downloaded PowerShell execution chain | Critical |
| `FG-SHELL-DOWNLOAD-EXEC` | Download piped to shell | Critical |
| `FG-VSCODE-FOLDER-OPEN` | Any VS Code task configured with `runOn: "folderOpen"` | High |
| `FG-VSCODE-AUTOEXEC` | Folder-open task with a download/execution, persistence, or destructive chain | Critical |
| `FG-VSCODE-DANGEROUS-AUTOMATION` | Suspicious editor task/debug command chain without confirmed automatic start | High |
| `FG-VSCODE-AUTOTASK-ON` | Repository setting enables automatic folder-open tasks | High |
| `FG-VSCODE-CONCEALMENT` | Extreme task indentation or combined wrap/minimap visibility reduction | High |
| `FG-ENV-EXPOSURE` | `.env` with no simple matching ignore rule found | Review |
| `FG-CONFIG-OVERSIZED` | Security-sensitive config exceeds safe read limit | Review; High for editor/container execution configuration |

Scoring thresholds are `1–29 Review`, `30–69 High`, and `70+ Critical`. Known IOCs and strong direct execution chains bypass normal scoring.

The combination rule deliberately suppresses weak, common signals on their own. A URL reference, ordinary application `fetch`, normal function declaration, minified long line, embedded base64 media asset, or dangerous API name quoted in the declarative `.semgrep.yml` rule file is not sufficient by itself. Process-launch/dynamic-execution imports, obfuscated identifiers, active network commands in executable configuration, or combined signals remain reportable.

Each fingerprint includes rule ID, normalized relative path, matched evidence, and the full content hash. It therefore changes when the file changes and supports alert-once-per-file-state behavior.
