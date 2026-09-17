import * as vscode from "vscode";
import type { ScanSnapshot } from "../workspace/scanner";

export async function exportJsonReport(snapshot: ScanSnapshot): Promise<void> {
  const destination = await vscode.window.showSaveDialog({
    title: "Export Codebase Guard JSON Report",
    filters: { "JSON report": ["json"] },
    saveLabel: "Export Report"
  });
  if (!destination) return;
  const version = vscode.extensions.getExtension("mh-jsx.frontend-guard")?.packageJSON.version;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanner: { name: "Codebase Guard", version: typeof version === "string" ? version : "unknown", mode: "static-only" },
    workspaceTrusted: vscode.workspace.isTrusted,
    summary: {
      critical: snapshot.findings.filter(item => item.severity === "critical").length,
      high: snapshot.findings.filter(item => item.severity === "high").length,
      review: snapshot.findings.filter(item => item.severity === "review").length,
      skipped: snapshot.skipped.length,
      coverage: snapshot.coverage
    },
    findings: snapshot.findings,
    skipped: snapshot.skipped
  };
  // This is the only runtime write: an explicit, user-selected report destination.
  await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`));
  void vscode.window.showInformationMessage("Codebase Guard report exported.");
}
