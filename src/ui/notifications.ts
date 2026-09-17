import * as vscode from "vscode";
import type { Finding } from "../scanner/types";
import type { ScanSnapshot } from "../workspace/scanner";

const STORAGE_KEY = "frontendGuard.criticalNotificationFingerprints";

export class CriticalNotifications {
  private showing = false;
  private notifiedDuringActivity = false;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public update(snapshot: ScanSnapshot, open: (finding: Finding) => Promise<void>): void {
    if (snapshot.activity === "idle") this.notifiedDuringActivity = false;
    const warned = new Set(this.context.workspaceState.get<readonly string[]>(STORAGE_KEY, []));
    const fresh = snapshot.findings.filter(finding => finding.severity === "critical" && !warned.has(finding.fingerprint));
    if (fresh.length === 0) return;
    for (const finding of fresh) warned.add(finding.fingerprint);
    void this.context.workspaceState.update(STORAGE_KEY, [...warned].slice(-500));

    // One visible alert is enough. Additional findings remain available in the
    // Control Center, Problems panel, tree view, and status bar.
    if (this.showing || (snapshot.activity !== "idle" && this.notifiedDuringActivity)) return;
    if (snapshot.activity !== "idle") this.notifiedDuringActivity = true;
    this.showing = true;
    void this.showSummary(fresh, open).finally(() => {
      this.showing = false;
    });
  }

  private async showSummary(fresh: readonly Finding[], open: (finding: Finding) => Promise<void>): Promise<void> {
    const files = new Set(fresh.map(finding => finding.relativePath)).size;
    const findingLabel = fresh.length === 1 ? "1 critical finding" : `${fresh.length} critical findings`;
    const fileLabel = files === 1 ? "1 file" : `${files} files`;
    const message = `Codebase Guard detected ${findingLabel} in ${fileLabel}. Review current findings before running installers, builds, scripts, or project tasks.`;
    const choice = fresh.length === 1
      ? await vscode.window.showErrorMessage(message, "Review Findings", "Open File")
      : await vscode.window.showErrorMessage(message, "Review Findings");
    if (choice === "Review Findings") await vscode.commands.executeCommand("frontendGuard.showFindings");
    if (choice === "Open File") await open(fresh[0]);
  }
}
