import * as vscode from "vscode";
import type { ScanSnapshot } from "../workspace/scanner";
import { readSettings } from "../workspace/settings";

export class GuardStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);

  public constructor() {
    this.item.command = "frontendGuard.showFindings";
    this.item.name = "Codebase Guard";
    this.item.text = "$(shield) Guard: waiting";
    this.item.tooltip = "Codebase Guard checks files without running code.";
    this.item.show();
  }

  public scanning(): void {
    this.item.text = "$(sync~spin) Guard: scanning";
    this.item.backgroundColor = undefined;
  }

  public update(snapshot: ScanSnapshot): void {
    if (snapshot.activity !== "idle") {
      this.scanning();
      this.item.tooltip = snapshot.activity === "changes"
        ? `Rechecking ${snapshot.queuedFiles} changed file(s) through the bounded queue.`
        : "Scanning security-sensitive configuration first, without running code.";
      return;
    }
    const critical = snapshot.findings.filter(finding => finding.severity === "critical").length;
    const high = snapshot.findings.filter(finding => finding.severity === "high").length;
    const review = snapshot.findings.filter(finding => finding.severity === "review").length;
    if (critical > 0) {
      this.item.text = `$(error) Guard: ${critical} critical`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (high > 0) {
      this.item.text = `$(warning) Guard: ${high} high`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.item.text = `$(shield) Guard: ${review > 0 ? `${review} review` : "clean"}`;
      this.item.backgroundColor = undefined;
    }
    const settings = readSettings();
    const trust = vscode.workspace.isTrusted ? "trusted" : "Restricted Mode";
    const controlled = settings.workspaceControlled ? " Workspace settings affect scanning." : "";
    const coverage = snapshot.coverage === "partial" ? " Coverage is partial." : "";
    this.item.tooltip = `Checked without running code in ${trust}. ${snapshot.findings.length} finding(s), ${snapshot.skipped.length} not inspected.${coverage}${controlled}`;
  }

  public dispose(): void {
    this.item.dispose();
  }
}
