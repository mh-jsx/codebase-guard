import * as vscode from "vscode";
import type { ScanSnapshot } from "../workspace/scanner";
import { readManagedWorkspaceExclusions, readSettings, type AutomaticScanMode } from "../workspace/settings";

export type FindingAction = "open" | "ignore" | "skipFile" | "skipFolder";

interface ControlCenterActions {
  readonly scanWorkspace: () => void | Promise<void>;
  readonly scanCurrentFile: () => void | Promise<void>;
  readonly showFindings: () => void | Promise<void>;
  readonly exportReport: () => void | Promise<void>;
  readonly configureExclusions: () => void | Promise<void>;
  readonly findingAction: (action: FindingAction, fingerprint: string) => void | Promise<void>;
  readonly skipCurrent: (kind: "file" | "folder") => void | Promise<void>;
  readonly setAutomaticScanMode: (mode: AutomaticScanMode) => void | Promise<void>;
  readonly openSettings: () => void | Promise<void>;
}

type ControlCenterMessage =
  | { readonly command: "scanWorkspace" | "scanCurrentFile" | "showFindings" | "exportReport" | "configureExclusions" | "openSettings" }
  | { readonly command: "findingAction"; readonly action: FindingAction; readonly fingerprint: string }
  | { readonly command: "skipCurrent"; readonly kind: "file" | "folder" }
  | { readonly command: "setAutomaticScanMode"; readonly mode: AutomaticScanMode };

interface ControlCenterFinding {
  readonly fingerprint: string;
  readonly relativePath: string;
  readonly ruleId: string;
  readonly title: string;
  readonly severity: "critical" | "high" | "review";
  readonly score: number;
  readonly hasParentFolder: boolean;
}

interface ControlCenterModel {
  readonly state: "idle" | "scanning" | "critical" | "high" | "review" | "clean";
  readonly eyebrow: string;
  readonly title: string;
  readonly message: string;
  readonly critical: number;
  readonly high: number;
  readonly review: number;
  readonly files: number;
  readonly skipped: number;
  readonly excluded: number;
  readonly scannedAt: string;
  readonly trusted: boolean;
  readonly enabled: boolean;
  readonly automaticScanMode: AutomaticScanMode;
  readonly workspaceOpen: boolean;
  readonly activity: ScanSnapshot["activity"];
  readonly coverage: ScanSnapshot["coverage"];
  readonly queuedFiles: number;
  readonly lastScanReason?: ScanSnapshot["lastScanReason"];
  readonly lastScanFileCount: number;
  readonly findings: readonly ControlCenterFinding[];
  readonly findingTotal: number;
  readonly currentFile: string;
  readonly currentFolder: string;
}

export class ControlCenterProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private snapshot: ScanSnapshot = {
    files: [], findings: [], skipped: [], scannedAt: "", activity: "idle", coverage: "not-scanned", queuedFiles: 0, lastScanFileCount: 0
  };
  private isScanning = false;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: ControlCenterActions
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (candidate: unknown) => {
        if (!isControlCenterMessage(candidate)) return;
        const message = candidate;
        switch (message.command) {
          case "scanWorkspace": await this.actions.scanWorkspace(); break;
          case "scanCurrentFile": await this.actions.scanCurrentFile(); break;
          case "showFindings": await this.actions.showFindings(); break;
          case "exportReport": await this.actions.exportReport(); break;
          case "configureExclusions": await this.actions.configureExclusions(); break;
          case "findingAction": await this.actions.findingAction(message.action, message.fingerprint); break;
          case "skipCurrent": await this.actions.skipCurrent(message.kind); break;
          case "setAutomaticScanMode": await this.actions.setAutomaticScanMode(message.mode); break;
          case "openSettings": await this.actions.openSettings(); break;
        }
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      })
    );
  }

  public scanning(): void {
    this.isScanning = true;
    this.postUpdate();
  }

  public update(snapshot: ScanSnapshot): void {
    this.snapshot = snapshot;
    this.isScanning = false;
    this.postUpdate();
  }

  public refresh(): void {
    this.postUpdate();
  }

  private postUpdate(): void {
    void this.view?.webview.postMessage({ type: "update", model: this.toModel() });
  }

  private toModel(): ControlCenterModel {
    const settings = readSettings();
    const critical = this.snapshot.findings.filter(finding => finding.severity === "critical").length;
    const high = this.snapshot.findings.filter(finding => finding.severity === "high").length;
    const review = this.snapshot.findings.filter(finding => finding.severity === "review").length;
    const severityOrder = { critical: 0, high: 1, review: 2 } as const;
    const findings = [...this.snapshot.findings]
      .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || right.score - left.score || left.relativePath.localeCompare(right.relativePath))
      .slice(0, 8)
      .map(finding => ({
        fingerprint: finding.fingerprint,
        relativePath: finding.relativePath,
        ruleId: finding.ruleId,
        title: finding.title,
        severity: finding.severity,
        score: finding.score,
        hasParentFolder: finding.relativePath.includes("/")
      }));
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    const activePath = activeUri && activeFolder ? vscode.workspace.asRelativePath(activeUri, false).replace(/\\/g, "/") : "";
    const slash = activePath.lastIndexOf("/");
    const base = {
      critical,
      high,
      review,
      files: this.snapshot.files.length,
      skipped: this.snapshot.skipped.length,
      excluded: readManagedWorkspaceExclusions().length,
      scannedAt: this.snapshot.scannedAt,
      trusted: vscode.workspace.isTrusted,
      enabled: settings.enabled,
      automaticScanMode: settings.automaticScanMode,
      activity: this.snapshot.activity,
      coverage: this.snapshot.coverage,
      queuedFiles: this.snapshot.queuedFiles,
      lastScanReason: this.snapshot.lastScanReason,
      lastScanFileCount: this.snapshot.lastScanFileCount,
      findings,
      findingTotal: this.snapshot.findings.length,
      currentFile: activePath,
      currentFolder: slash > 0 ? activePath.slice(0, slash) : "",
      workspaceOpen: Boolean(vscode.workspace.workspaceFolders?.length)
    };

    if (this.isScanning || this.snapshot.activity !== "idle") {
      const changing = this.snapshot.activity === "changes";
      return {
        ...base,
        state: "scanning",
        eyebrow: changing ? "RECHECKING RECENT CHANGES" : "SECURITY-SENSITIVE FILES FIRST",
        title: changing ? `Rechecking ${Math.max(1, this.snapshot.queuedFiles)} changed ${Math.max(1, this.snapshot.queuedFiles) === 1 ? "file" : "files"}` : "Scanning without running code",
        message: changing ? "Only the latest state of each changed file is checked." : "Editor automation and executable configuration are checked first."
      };
    }
    if (!this.snapshot.scannedAt) return { ...base, state: "idle", eyebrow: "READY", title: "Check this codebase before you run it", message: "The scan stays local and only reads files." };
    if (critical > 0) return { ...base, state: "critical", eyebrow: "REVIEW BEFORE RUNNING CODE", title: `${critical} critical ${critical === 1 ? "finding" : "findings"}`, message: "Open the flagged files and verify them before running this codebase." };
    if (high > 0) return { ...base, state: "high", eyebrow: "REVIEW RECOMMENDED", title: `${high} high-risk ${high === 1 ? "finding" : "findings"}`, message: "Review the flagged behavior before running project commands." };
    if (review > 0) return { ...base, state: "review", eyebrow: "QUICK REVIEW RECOMMENDED", title: `${review} ${review === 1 ? "item needs" : "items need"} review`, message: "These signals may be legitimate; inspect them and choose a clear action." };
    return { ...base, state: "clean", eyebrow: "NO WARNINGS FOUND", title: "Nothing needs review right now", message: settings.automaticScanMode === "live" ? "Live protection will recheck relevant changed files." : "Run Scan again whenever the codebase changes." };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const initialModel = JSON.stringify(this.toModel()).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --panel: color-mix(in srgb, var(--vscode-sideBar-background) 91%, var(--vscode-foreground) 9%);
      --soft: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--vscode-foreground) 4%);
      --line: color-mix(in srgb, var(--vscode-sideBarSectionHeader-border, var(--vscode-contrastBorder)) 78%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --critical: var(--vscode-testing-iconFailed, #f14c4c);
      --high: var(--vscode-editorWarning-foreground, #cca700);
      --review: var(--vscode-editorInfo-foreground, #3794ff);
      --clean: var(--vscode-testing-iconPassed, #23a55a);
      --accent: var(--vscode-focusBorder, #007fd4);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body { padding: 10px 12px 15px; color: var(--vscode-sideBar-foreground); background: var(--vscode-sideBar-background); font: 12px/1.4 var(--vscode-font-family); }
    button { font: inherit; }
    [hidden] { display: none !important; }
    .shell { display: grid; gap: 10px; }
    .hero { --state-color: var(--accent); padding: 12px 13px; border: 1px solid color-mix(in srgb, var(--state-color) 35%, var(--line)); border-left: 3px solid var(--state-color); border-radius: 7px; background: linear-gradient(110deg, color-mix(in srgb, var(--state-color) 9%, transparent), transparent 60%), var(--panel); }
    .hero[data-state="critical"] { --state-color: var(--critical); }
    .hero[data-state="high"] { --state-color: var(--high); }
    .hero[data-state="review"] { --state-color: var(--review); }
    .hero[data-state="clean"] { --state-color: var(--clean); }
    .eyebrow { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; color: var(--state-color); font-size: 9px; font-weight: 750; letter-spacing: .1em; }
    .signal { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 13%, transparent); }
    [data-state="scanning"] .signal { animation: pulse 1.15s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .35; transform: scale(.72); } }
    @media (prefers-reduced-motion: reduce) { .signal { animation: none !important; } }
    h1 { margin: 0 0 4px; font-size: 16px; line-height: 1.23; letter-spacing: -.012em; }
    .summary { margin: 0; color: var(--muted); }
    .primary-action { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 9px; width: 100%; min-height: 54px; padding: 10px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 7px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); text-align: left; cursor: pointer; }
    .primary-action:hover { background: var(--vscode-button-hoverBackground); }
    .primary-action:disabled { opacity: .58; cursor: wait; }
    .primary-icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; background: color-mix(in srgb, white 14%, transparent); font-size: 15px; }
    .primary-title { display: block; font-size: 13px; font-weight: 750; }
    .primary-hint { display: block; margin-top: 1px; opacity: .8; font-size: 10px; }
    .primary-arrow { font-size: 17px; }
    .primary-action:focus-visible, .action:focus-visible, .mode-option:focus-visible, .metric:focus-visible, .text-action:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; background: var(--panel); }
    .metric { min-width: 0; padding: 8px 9px; border: 0; border-right: 1px solid var(--line); color: inherit; background: transparent; text-align: left; cursor: pointer; }
    .metric:last-child { border-right: 0; }
    .metric:hover { background: var(--vscode-list-hoverBackground); }
    .metric-value { display: block; margin-bottom: 2px; font-size: 17px; font-weight: 750; line-height: 1; }
    .metric-label { display: block; color: var(--muted); font-size: 10px; }
    .metric.critical .metric-value { color: var(--critical); }
    .metric.high .metric-value { color: var(--high); }
    .metric.review .metric-value { color: var(--review); }
    .section { display: grid; gap: 7px; }
    .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 1px; }
    .section-heading { margin: 0; color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .075em; text-transform: uppercase; }
    .section-count { color: var(--muted); font-size: 9px; }
    .finding-list { display: grid; gap: 7px; }
    .finding-card { --severity-color: var(--review); overflow: hidden; border: 1px solid color-mix(in srgb, var(--severity-color) 32%, var(--line)); border-radius: 7px; background: var(--panel); }
    .finding-card[data-severity="critical"] { --severity-color: var(--critical); }
    .finding-card[data-severity="high"] { --severity-color: var(--high); }
    .finding-main { padding: 9px 10px 8px; border-left: 3px solid var(--severity-color); }
    .finding-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .severity { color: var(--severity-color); font-size: 9px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .rule { overflow: hidden; color: var(--muted); font: 9px/1.2 var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
    .score { margin-left: auto; color: var(--muted); font-size: 9px; }
    .finding-title { overflow: hidden; margin: 0 0 2px; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .finding-path { overflow: hidden; color: var(--muted); font: 9px/1.3 var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
    .finding-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; border-top: 1px solid var(--line); background: var(--line); }
    .action { min-width: 0; min-height: 30px; padding: 5px 4px; border: 0; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 9px; font-weight: 650; cursor: pointer; }
    .action:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .action:disabled { color: var(--muted); opacity: .48; cursor: not-allowed; }
    .action.primary-small { color: var(--vscode-textLink-foreground); }
    .view-all { justify-self: stretch; min-height: 32px; border: 1px solid var(--line); border-radius: 6px; color: var(--vscode-textLink-foreground); background: transparent; cursor: pointer; }
    .view-all:hover { background: var(--vscode-list-hoverBackground); }
    .card { padding: 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--soft); }
    .target-path { overflow: hidden; margin-bottom: 8px; color: var(--vscode-sideBar-foreground); font: 10px/1.35 var(--vscode-editor-font-family); text-overflow: ellipsis; white-space: nowrap; }
    .target-path.empty { color: var(--muted); font-family: var(--vscode-font-family); }
    .button-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
    .button-row.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .utility { min-width: 0; min-height: 34px; padding: 6px; border: 1px solid var(--vscode-button-border, var(--line)); border-radius: 5px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 9px; font-weight: 650; cursor: pointer; }
    .utility:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .utility:disabled { opacity: .48; cursor: not-allowed; }
    .manage { display: grid; grid-template-columns: 1fr auto; align-items: center; width: 100%; min-height: 43px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; color: inherit; background: var(--panel); text-align: left; cursor: pointer; }
    .manage:hover { background: var(--vscode-list-hoverBackground); }
    .manage-title { display: block; font-weight: 700; }
    .manage-hint { display: block; margin-top: 1px; color: var(--muted); font-size: 9px; }
    .count-badge { min-width: 23px; padding: 2px 6px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; font-weight: 700; text-align: center; }
    .auto-card { padding: 9px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--soft); }
    .auto-head { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: 8px; }
    .auto-indicator { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: var(--clean); box-shadow: 0 0 0 3px color-mix(in srgb, var(--clean) 11%, transparent); }
    .auto-card[data-enabled="false"] .auto-indicator { background: var(--muted); box-shadow: none; }
    .auto-title { display: block; font-weight: 700; }
    .auto-copy { display: block; margin-top: 1px; color: var(--muted); font-size: 9px; }
    .auto-badge { padding: 2px 6px; border-radius: 999px; color: var(--clean); background: color-mix(in srgb, var(--clean) 11%, transparent); font-size: 9px; font-weight: 750; text-transform: uppercase; }
    .auto-card[data-enabled="false"] .auto-badge { color: var(--muted); background: color-mix(in srgb, var(--muted) 10%, transparent); }
    .mode-switch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-top: 8px; padding: 3px; border: 1px solid var(--line); border-radius: 6px; background: var(--vscode-input-background); }
    .mode-option { min-width: 0; padding: 5px 3px; border: 0; border-radius: 4px; color: var(--muted); background: transparent; font-size: 9px; cursor: pointer; }
    .mode-option:hover { color: inherit; background: var(--vscode-list-hoverBackground); }
    .mode-option[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-weight: 700; }
    .mode-option:disabled { opacity: .48; cursor: not-allowed; }
    details { border: 1px solid var(--line); border-radius: 7px; background: var(--soft); }
    summary { padding: 8px 10px; color: var(--muted); font-size: 10px; font-weight: 700; cursor: pointer; }
    .ledger { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
    .ledger-cell { min-width: 0; padding: 7px 9px; border-bottom: 1px solid var(--line); }
    .ledger-cell:nth-child(odd) { border-right: 1px solid var(--line); }
    .ledger-cell.wide { grid-column: 1 / -1; border-right: 0; }
    .ledger-label { display: block; color: var(--muted); font-size: 9px; }
    .ledger-value { display: block; overflow: hidden; margin-top: 1px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .footer { display: grid; gap: 7px; }
    .trust-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
    .trust-chip { padding: 4px 3px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 8px; text-align: center; white-space: nowrap; }
    .trust-chip::before { content: "✓"; margin-right: 3px; color: var(--clean); font-weight: 700; }
    .footer-line { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
    .boundary { color: var(--muted); font-size: 9px; }
    .text-action { padding: 3px 0; border: 0; color: var(--vscode-textLink-foreground); background: transparent; cursor: pointer; }
    .text-action:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
    @media (max-width: 255px) { .finding-actions { grid-template-columns: repeat(2, 1fr); } .button-row { grid-template-columns: 1fr; } .trust-strip { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero" id="hero" aria-live="polite">
      <div class="eyebrow"><span class="signal"></span><span id="eyebrow"></span></div>
      <h1 id="title"></h1>
      <p class="summary" id="message"></p>
    </section>

    <button class="primary-action" id="primaryAction" data-command="scanWorkspace">
      <span class="primary-icon" aria-hidden="true">↻</span>
      <span><span class="primary-title" id="primaryTitle">Scan workspace</span><span class="primary-hint" id="primaryHint">Check every supported file without running code</span></span>
      <span class="primary-arrow" aria-hidden="true">→</span>
    </button>

    <section class="metrics" aria-label="Finding totals">
      <button class="metric critical" data-command="showFindings"><span class="metric-value" id="critical">0</span><span class="metric-label">Critical</span></button>
      <button class="metric high" data-command="showFindings"><span class="metric-value" id="high">0</span><span class="metric-label">High</span></button>
      <button class="metric review" data-command="showFindings"><span class="metric-value" id="review">0</span><span class="metric-label">Review</span></button>
    </section>

    <section class="section" id="findingsSection" hidden>
      <div class="section-head"><h2 class="section-heading">Files needing attention</h2><span class="section-count" id="findingCount"></span></div>
      <div class="finding-list" id="findingList"></div>
      <button class="view-all" id="viewAll" data-command="showFindings">View all findings</button>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-heading">Current location</h2></div>
      <div class="card">
        <div class="target-path empty" id="currentPath">Open a workspace file to use these actions</div>
        <div class="button-row">
          <button class="utility" id="scanCurrent" data-command="scanCurrentFile">Scan file</button>
          <button class="utility" id="skipCurrentFile" data-skip-current="file">Skip file</button>
          <button class="utility" id="skipCurrentFolder" data-skip-current="folder">Skip folder</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-heading">Skipped files and folders</h2></div>
      <button class="manage" data-command="configureExclusions">
        <span><span class="manage-title">Manage skipped items</span><span class="manage-hint" id="excludeHint">Add, review, or restore files and folders</span></span>
        <span class="count-badge" id="excluded">0</span>
      </button>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-heading">Automatic protection</h2></div>
      <div class="auto-card" id="autoCard" aria-live="polite">
        <div class="auto-head">
          <span class="auto-indicator" aria-hidden="true"></span>
          <span><strong class="auto-title" id="autoTitle"></strong><span class="auto-copy" id="autoCopy"></span></span>
          <span class="auto-badge" id="autoBadge"></span>
        </div>
        <div class="mode-switch" aria-label="Automatic scanning mode">
          <button class="mode-option" data-mode="live">Live</button>
          <button class="mode-option" data-mode="open">On open</button>
          <button class="mode-option" data-mode="manual">Manual</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-heading">Other actions</h2></div>
      <div class="button-row two"><button class="utility" data-command="exportReport">Export report</button><button class="utility" data-command="openSettings">Settings</button></div>
    </section>

    <details>
      <summary>Last scan details</summary>
      <div class="ledger">
        <div class="ledger-cell"><span class="ledger-label">Files checked</span><span class="ledger-value" id="files">0</span></div>
        <div class="ledger-cell"><span class="ledger-label">Could not inspect</span><span class="ledger-value" id="skipped">0</span></div>
        <div class="ledger-cell"><span class="ledger-label">Coverage</span><span class="ledger-value" id="coverage">Not scanned</span></div>
        <div class="ledger-cell"><span class="ledger-label">Workspace mode</span><span class="ledger-value" id="trust">Restricted</span></div>
        <div class="ledger-cell wide"><span class="ledger-label">Last action</span><span class="ledger-value" id="lastAction">None</span></div>
        <div class="ledger-cell wide"><span class="ledger-label">Completed</span><span class="ledger-value" id="scannedAt">Not yet scanned</span></div>
      </div>
    </details>

    <footer class="footer">
      <div class="trust-strip"><span class="trust-chip">Local only</span><span class="trust-chip">No code run</span><span class="trust-chip">No telemetry</span></div>
      <div class="footer-line"><span class="boundary">Warnings are clues, not proof.</span><button class="text-action" data-command="showFindings">Finding details →</button></div>
    </footer>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const elements = {
      hero: document.getElementById("hero"), eyebrow: document.getElementById("eyebrow"), title: document.getElementById("title"), message: document.getElementById("message"),
      primaryAction: document.getElementById("primaryAction"), primaryTitle: document.getElementById("primaryTitle"), primaryHint: document.getElementById("primaryHint"),
      critical: document.getElementById("critical"), high: document.getElementById("high"), review: document.getElementById("review"),
      findingsSection: document.getElementById("findingsSection"), findingList: document.getElementById("findingList"), findingCount: document.getElementById("findingCount"), viewAll: document.getElementById("viewAll"),
      currentPath: document.getElementById("currentPath"), scanCurrent: document.getElementById("scanCurrent"), skipCurrentFile: document.getElementById("skipCurrentFile"), skipCurrentFolder: document.getElementById("skipCurrentFolder"),
      autoCard: document.getElementById("autoCard"), autoTitle: document.getElementById("autoTitle"), autoCopy: document.getElementById("autoCopy"), autoBadge: document.getElementById("autoBadge"),
      files: document.getElementById("files"), skipped: document.getElementById("skipped"), excluded: document.getElementById("excluded"), excludeHint: document.getElementById("excludeHint"),
      scannedAt: document.getElementById("scannedAt"), trust: document.getElementById("trust"), coverage: document.getElementById("coverage"), lastAction: document.getElementById("lastAction"),
      modeOptions: Array.from(document.querySelectorAll("[data-mode]"))
    };

    function addText(parent, className, value) {
      const node = document.createElement("span");
      node.className = className;
      node.textContent = value;
      parent.appendChild(node);
    }

    function findingButton(label, action, finding, disabled = false) {
      const button = document.createElement("button");
      button.className = "action" + (action === "open" ? " primary-small" : "");
      button.textContent = label;
      button.dataset.findingAction = action;
      button.dataset.fingerprint = finding.fingerprint;
      button.disabled = disabled;
      if (disabled) button.title = "This file is at the workspace root";
      return button;
    }

    function renderFindings(model) {
      elements.findingList.replaceChildren();
      elements.findingsSection.hidden = model.findingTotal === 0;
      elements.findingCount.textContent = model.findingTotal > model.findings.length ? "Showing " + model.findings.length + " of " + model.findingTotal : model.findingTotal + " total";
      elements.viewAll.textContent = model.findingTotal > model.findings.length ? "View all " + model.findingTotal + " findings" : "Open Finding Details";
      for (const finding of model.findings) {
        const card = document.createElement("article");
        card.className = "finding-card";
        card.dataset.severity = finding.severity;
        const main = document.createElement("div");
        main.className = "finding-main";
        const meta = document.createElement("div");
        meta.className = "finding-meta";
        addText(meta, "severity", finding.severity);
        addText(meta, "rule", finding.ruleId);
        addText(meta, "score", "Score " + finding.score);
        main.appendChild(meta);
        const title = document.createElement("div");
        title.className = "finding-title";
        title.textContent = finding.title;
        title.title = finding.title;
        main.appendChild(title);
        const path = document.createElement("div");
        path.className = "finding-path";
        path.textContent = finding.relativePath;
        path.title = finding.relativePath;
        main.appendChild(path);
        card.appendChild(main);
        const actions = document.createElement("div");
        actions.className = "finding-actions";
        actions.appendChild(findingButton("Open file", "open", finding));
        actions.appendChild(findingButton("Hide alert", "ignore", finding));
        actions.appendChild(findingButton("Skip file", "skipFile", finding));
        actions.appendChild(findingButton("Skip folder", "skipFolder", finding, !finding.hasParentFolder));
        card.appendChild(actions);
        elements.findingList.appendChild(card);
      }
    }

    function render(model) {
      elements.hero.dataset.state = model.state;
      elements.eyebrow.textContent = model.eyebrow;
      elements.title.textContent = model.title;
      elements.message.textContent = model.message;
      elements.critical.textContent = String(model.critical);
      elements.high.textContent = String(model.high);
      elements.review.textContent = String(model.review);
      elements.files.textContent = String(model.files);
      elements.skipped.textContent = String(model.skipped);
      elements.excluded.textContent = String(model.excluded);
      elements.excludeHint.textContent = model.excluded > 0 ? model.excluded + " path" + (model.excluded === 1 ? "" : "s") + " currently skipped" : "Add, review, or restore files and folders";
      elements.scannedAt.textContent = model.scannedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(model.scannedAt)) : "Not yet scanned";
      elements.trust.textContent = model.trusted ? "Trusted" : "Restricted";
      elements.coverage.textContent = model.coverage === "complete" ? "Complete" : model.coverage === "partial" ? "Partial" : "Not scanned";
      const reasonLabels = { startup: "Opened codebase", manual: "Full manual scan", changes: "Changed files", "current-file": "Current file" };
      elements.lastAction.textContent = model.lastScanReason ? reasonLabels[model.lastScanReason] + " · " + model.lastScanFileCount : "None";
      renderFindings(model);

      const hasCurrentFile = Boolean(model.currentFile);
      elements.currentPath.textContent = hasCurrentFile ? model.currentFile : "Open a workspace file to use these actions";
      elements.currentPath.title = model.currentFile;
      elements.currentPath.classList.toggle("empty", !hasCurrentFile);
      elements.scanCurrent.disabled = !hasCurrentFile || !model.enabled;
      elements.skipCurrentFile.disabled = !hasCurrentFile;
      elements.skipCurrentFolder.disabled = !model.currentFolder;
      elements.skipCurrentFolder.title = model.currentFolder ? "Skip " + model.currentFolder : "The current file is at the workspace root";

      const automatic = model.enabled && model.automaticScanMode !== "manual";
      elements.autoCard.dataset.enabled = String(automatic);
      elements.autoBadge.textContent = !model.enabled ? "Off" : model.automaticScanMode === "live" ? "Live" : model.automaticScanMode === "open" ? "On open" : "Manual";
      for (const option of elements.modeOptions) {
        option.setAttribute("aria-pressed", String(option.dataset.mode === model.automaticScanMode));
        option.disabled = !model.enabled;
      }
      if (!model.enabled) {
        elements.autoTitle.textContent = "Codebase Guard is off";
        elements.autoCopy.textContent = "Open Settings to enable scanning.";
      } else if (model.automaticScanMode === "live") {
        elements.autoTitle.textContent = "Automatic scanning is on";
        elements.autoCopy.textContent = "Scans on open, then rechecks relevant changed files.";
      } else if (model.automaticScanMode === "open") {
        elements.autoTitle.textContent = "Scan on open only";
        elements.autoCopy.textContent = "No change monitor remains active after opening.";
      } else {
        elements.autoTitle.textContent = "Manual scanning";
        elements.autoCopy.textContent = "Nothing scans in the background.";
      }

      elements.primaryAction.disabled = false;
      if (!model.enabled) {
        elements.primaryAction.dataset.command = "openSettings";
        elements.primaryTitle.textContent = "Enable Codebase Guard";
        elements.primaryHint.textContent = "Open Settings to turn scanning on";
      } else if (!model.workspaceOpen) {
        elements.primaryAction.dataset.command = "scanWorkspace";
        elements.primaryAction.disabled = true;
        elements.primaryTitle.textContent = "Open a codebase to scan";
        elements.primaryHint.textContent = "Codebase Guard checks the currently opened workspace";
      } else if (model.state === "scanning") {
        elements.primaryAction.dataset.command = "scanWorkspace";
        elements.primaryAction.disabled = true;
        elements.primaryTitle.textContent = "Scanning workspace…";
        elements.primaryHint.textContent = "Reading files without executing project code";
      } else {
        elements.primaryAction.dataset.command = "scanWorkspace";
        elements.primaryTitle.textContent = model.scannedAt ? "Scan again" : "Scan workspace";
        elements.primaryHint.textContent = model.scannedAt ? "Run a fresh full check of this codebase" : "Check every supported file without running code";
      }
    }

    document.addEventListener("click", event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const command = target.closest("[data-command]");
      if (command instanceof HTMLButtonElement && !command.disabled) vscode.postMessage({ command: command.dataset.command });
      const mode = target.closest("[data-mode]");
      if (mode instanceof HTMLButtonElement && !mode.disabled) vscode.postMessage({ command: "setAutomaticScanMode", mode: mode.dataset.mode });
      const finding = target.closest("[data-finding-action]");
      if (finding instanceof HTMLButtonElement && !finding.disabled) vscode.postMessage({ command: "findingAction", action: finding.dataset.findingAction, fingerprint: finding.dataset.fingerprint });
      const skipCurrent = target.closest("[data-skip-current]");
      if (skipCurrent instanceof HTMLButtonElement && !skipCurrent.disabled) vscode.postMessage({ command: "skipCurrent", kind: skipCurrent.dataset.skipCurrent });
    });
    window.addEventListener("message", event => { if (event.data?.type === "update") render(event.data.model); });
    render(${initialModel});
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.view = undefined;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}

function isControlCenterMessage(candidate: unknown): candidate is ControlCenterMessage {
  if (!candidate || typeof candidate !== "object" || !("command" in candidate)) return false;
  const message = candidate as { command?: unknown; mode?: unknown; action?: unknown; fingerprint?: unknown; kind?: unknown };
  if (message.command === "setAutomaticScanMode") return message.mode === "live" || message.mode === "open" || message.mode === "manual";
  if (message.command === "findingAction") {
    const validAction = message.action === "open" || message.action === "ignore" || message.action === "skipFile" || message.action === "skipFolder";
    return validAction && typeof message.fingerprint === "string" && message.fingerprint.length > 0 && message.fingerprint.length <= 512;
  }
  if (message.command === "skipCurrent") return message.kind === "file" || message.kind === "folder";
  return message.command === "scanWorkspace" || message.command === "scanCurrentFile" || message.command === "showFindings" || message.command === "exportReport" || message.command === "configureExclusions" || message.command === "openSettings";
}
