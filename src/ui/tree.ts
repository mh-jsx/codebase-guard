import * as vscode from "vscode";
import type { Finding, Severity, SkippedFile } from "../scanner/types";
import type { ScanSnapshot, StoredFileResult } from "../workspace/scanner";

type TreeNode = SeverityGroup | FindingNode | SkippedGroup | SkippedNode | EmptyNode;

interface SeverityGroup { readonly kind: "severity"; readonly severity: Severity; readonly findings: readonly LocatedFinding[]; }
interface SkippedGroup { readonly kind: "skipped"; readonly files: readonly LocatedSkipped[]; }
interface LocatedFinding { readonly finding: Finding; readonly file: StoredFileResult; }
interface LocatedSkipped { readonly skipped: SkippedFile; readonly file: StoredFileResult; }
export interface FindingNode { readonly kind: "finding"; readonly finding: Finding; readonly uri: vscode.Uri; }
interface SkippedNode { readonly kind: "skipped-file"; readonly skipped: SkippedFile; }
interface EmptyNode { readonly kind: "empty"; }

const LABELS: Record<Severity, string> = { critical: "Critical", high: "High", review: "Review" };

export class FindingsTree implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  private snapshot: ScanSnapshot = {
    files: [], findings: [], skipped: [], scannedAt: "", activity: "idle", coverage: "not-scanned", queuedFiles: 0, lastScanFileCount: 0
  };

  public update(snapshot: ScanSnapshot): void {
    this.snapshot = snapshot;
    this.changed.fire(undefined);
  }

  public getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const groups: TreeNode[] = [];
      for (const severity of ["critical", "high", "review"] as const) {
        const findings = this.snapshot.files.flatMap(file => file.findings
          .filter(finding => finding.severity === severity)
          .map(finding => ({ finding, file })));
        if (findings.length > 0) groups.push({ kind: "severity", severity, findings });
      }
      const skipped = this.snapshot.files.flatMap(file => file.skipped ? [{ skipped: file.skipped, file }] : []);
      if (skipped.length > 0) groups.push({ kind: "skipped", files: skipped });
      if (groups.length === 0) groups.push({ kind: "empty" });
      return groups;
    }
    if (element.kind === "severity") return element.findings.map(item => ({ kind: "finding", finding: item.finding, uri: item.file.uri }));
    if (element.kind === "skipped") return element.files.map(item => ({ kind: "skipped-file", skipped: item.skipped }));
    return [];
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === "empty") {
      const item = new vscode.TreeItem(this.snapshot.scannedAt ? "No findings" : "Scan has not completed");
      item.iconPath = new vscode.ThemeIcon(this.snapshot.scannedAt ? "pass" : "clock");
      return item;
    }
    if (element.kind === "severity") {
      const item = new vscode.TreeItem(`${LABELS[element.severity]} (${element.findings.length})`, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(element.severity === "critical" ? "error" : element.severity === "high" ? "warning" : "info");
      return item;
    }
    if (element.kind === "skipped") {
      const item = new vscode.TreeItem(`Skipped (${element.files.length})`, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("circle-slash");
      return item;
    }
    if (element.kind === "skipped-file") {
      const item = new vscode.TreeItem(element.skipped.relativePath);
      item.description = element.skipped.reason;
      item.iconPath = new vscode.ThemeIcon("file-binary");
      return item;
    }
    const item = new vscode.TreeItem(element.finding.relativePath);
    item.description = element.finding.ruleId;
    item.tooltip = new vscode.MarkdownString(`**${element.finding.title}**\n\n${element.finding.description}\n\nScore: ${element.finding.score} · Confidence: ${element.finding.confidence}\n\nNamed Open, Hide, Skip file, and Skip folder actions are always visible in the Control Center.`);
    item.iconPath = new vscode.ThemeIcon(element.finding.severity === "critical" ? "error" : element.finding.severity === "high" ? "warning" : "info");
    item.contextValue = "frontendGuard.finding";
    item.command = { command: "frontendGuard.openFinding", title: "Open Finding", arguments: [element] };
    return item;
  }

  public dispose(): void {
    this.changed.dispose();
  }
}
