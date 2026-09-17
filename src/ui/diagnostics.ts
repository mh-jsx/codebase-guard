import * as vscode from "vscode";
import type { Finding } from "../scanner/types";
import type { ScanSnapshot } from "../workspace/scanner";

export class FindingDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("frontendGuard");

  public update(snapshot: ScanSnapshot): void {
    this.collection.clear();
    for (const file of snapshot.files) {
      if (file.findings.length === 0) continue;
      this.collection.set(file.uri, file.findings.map(finding => this.toDiagnostic(finding)));
    }
  }

  private toDiagnostic(finding: Finding): vscode.Diagnostic {
    const start = new vscode.Position(finding.position.line, finding.position.character);
    const range = new vscode.Range(start, start.translate(0, Math.max(1, finding.length)));
    const severity = finding.severity === "critical"
      ? vscode.DiagnosticSeverity.Error
      : finding.severity === "high"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    const diagnostic = new vscode.Diagnostic(range, `${finding.title}: ${finding.description}`, severity);
    diagnostic.source = "Codebase Guard";
    diagnostic.code = finding.ruleId;
    return diagnostic;
  }

  public dispose(): void {
    this.collection.dispose();
  }
}
