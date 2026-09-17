# Changelog

## 0.1.7

- Open-sourced Codebase Guard under the MIT License.
- Added public repository, issue tracker, homepage, and source links to the extension manifest.
- Added contribution, support, security-reporting, issue-template, pull-request, and community conduct guidance.
- Made release-directory preparation work consistently across macOS, Windows, and Linux development environments.

## 0.1.6

- Replaced the per-finding Critical notification queue with one summarized alert per scan or changed-file batch.
- Suppressed additional Critical popups while an alert is already visible, while keeping every finding in the Control Center, Problems panel, tree view, and status bar.
- Removed the redundant Dismiss action; the notification close control remains available.

## 0.1.5

- Kept Scan workspace / Scan again as the single main action, even when findings are present.
- Added compact finding cards with always-visible, named Open file, Hide alert, Skip file, and Skip folder actions.
- Added a current-location panel for scanning or skipping the active file and skipping its parent folder.
- Made the skipped-items manager permanently visible with its current exclusion count.
- Reduced instructional UI and moved detailed scan metadata into a collapsible section.
- Validated all finding actions against current scanner results before applying them.

## 0.1.4

- Added Live protection, Scan on open only, and Manual scanning modes to the sidebar.
- Replaced per-file debounce timers with one priority queue that coalesces large change bursts and limits file reads to two at a time.
- Stopped all change-monitor subscriptions outside Live protection and reduced startup scan concurrency.
- Prioritized `.vscode`, development-container, package lifecycle, and other sensitive configuration during discovery.
- Added explicit partial coverage, last-trigger, changed-file, and skipped-file status.
- Added JSONC-aware detection for `runOn: "folderOpen"`, dangerous automatic task chains, workspace automatic-task permission, and concealment settings or indentation.
- Raised oversized VS Code and development-container configuration to High because the content could not be inspected.
- Added stress tests for 10,000 change events and a two-reader concurrency ceiling.

## 0.1.3

- Prepared Codebase Guard for free public distribution through Open VSX and Cursor.
- Added a proprietary end-user license while keeping the source repository private.
- Added public marketplace installation guidance and release metadata.

## 0.1.2

- Renamed the visible product to Codebase Guard while preserving existing command IDs and settings.
- Added a new Codebase Guard logo for the Marketplace and activity bar.
- Expanded first-class scanning and file watching for PHP, Laravel, Composer, Python, Ruby, Java, Go, Rust, and other common project files.
- Added Composer lifecycle-script checks and PHP execution, download, and decoder signals.
- Rewrote product and warning copy in simpler, framework-neutral language.

## 0.1.1

- Reworked the Control Center around one recommended next action instead of equal-weight controls.
- Made automatic scanning, local-only analysis, zero execution, and no telemetry visible at a glance.
- Added in-context guidance for hiding a reviewed alert or skipping its file or any parent folder.
- Simplified skip management and last-inspection details for faster sidebar navigation.

## 0.1.0

- Initial private MVP with local, static-only workspace scanning.
- Added incident IOC and combination-based heuristic detection.
- Added Restricted Mode support, Problems diagnostics, activity view, status bar, de-duplicated critical alerts, allowlisting, exclusions, JSON export, tests, and compiled-runtime security audit.
