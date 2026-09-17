import * as vscode from "vscode";
import { analyzeFile } from "../scanner/analyzer";
import { isEnvironmentFile, isRelevantFile, isSensitiveConfig, priorityForPath } from "../scanner/paths";
import type { Finding, SkippedFile } from "../scanner/types";
import { ChangeBatch, type PendingChangeKind } from "./change-batch";
import { discoverFiles, environmentFilePotentiallyUnignored, relativePath } from "./discovery";
import { matchesAnyGlob } from "./glob";
import { readSettings, type AutomaticScanMode } from "./settings";
import { runWithConcurrency } from "./work-pool";

export interface StoredFileResult {
  readonly uri: vscode.Uri;
  readonly relativePath: string;
  readonly findings: readonly Finding[];
  readonly skipped?: SkippedFile;
}

export type ScanActivity = "idle" | "workspace" | "changes";
export type CoverageState = "not-scanned" | "complete" | "partial";
export type ScanReason = "startup" | "manual" | "changes" | "current-file";

export interface ScanSnapshot {
  readonly files: readonly StoredFileResult[];
  readonly findings: readonly Finding[];
  readonly skipped: readonly SkippedFile[];
  readonly scannedAt: string;
  readonly activity: ScanActivity;
  readonly coverage: CoverageState;
  readonly queuedFiles: number;
  readonly lastScanReason?: ScanReason;
  readonly lastScanFileCount: number;
}

type SnapshotListener = (snapshot: ScanSnapshot) => void;

const CHANGE_DEBOUNCE_MS = 500;
const FILE_READ_CONCURRENCY = 2;

export class WorkspaceScanner implements vscode.Disposable {
  private readonly results = new Map<string, StoredFileResult>();
  private readonly listeners = new Set<SnapshotListener>();
  private readonly changes = new ChangeBatch<vscode.Uri>();
  private readonly monitoringDisposables: vscode.Disposable[] = [];
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private flushRunning = false;
  private activeChangeCount = 0;
  private monitoredMode: AutomaticScanMode | undefined;
  private monitoringRunId = 0;
  private workspaceRunId = 0;
  private scannedAt = "";
  private activity: ScanActivity = "idle";
  private coverage: CoverageState = "not-scanned";
  private lastScanReason: ScanReason | undefined;
  private lastScanFileCount = 0;

  public onDidChange(listener: SnapshotListener): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public snapshot(): ScanSnapshot {
    const files = [...this.results.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return {
      files,
      findings: files.flatMap(file => [...file.findings]),
      skipped: files.flatMap(file => file.skipped ? [file.skipped] : []),
      scannedAt: this.scannedAt,
      activity: this.activity,
      coverage: this.coverage,
      queuedFiles: this.changes.size + this.activeChangeCount,
      lastScanReason: this.lastScanReason,
      lastScanFileCount: this.lastScanFileCount
    };
  }

  public async scanWorkspace(
    reason: "startup" | "manual" = "manual",
    token?: vscode.CancellationToken,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<ScanSnapshot> {
    const runId = ++this.workspaceRunId;
    const settings = readSettings();
    if (!settings.enabled) {
      this.results.clear();
      this.activity = "idle";
      this.coverage = "not-scanned";
      this.emit();
      return this.snapshot();
    }

    this.activity = "workspace";
    this.emit();
    const discovery = await discoverFiles(settings.exclude, settings.maxFiles);
    if (runId !== this.workspaceRunId) return this.snapshot();

    const uris = discovery.uris;
    const nextKeys = new Set(uris.map(uri => uri.toString()));
    for (const key of this.results.keys()) if (!nextKeys.has(key)) this.results.delete(key);

    let completed = 0;
    let incomplete = false;
    await runWithConcurrency(uris, FILE_READ_CONCURRENCY, async uri => {
      if (runId !== this.workspaceRunId || token?.isCancellationRequested) return;
      const result = await this.readFileResult(uri);
      if (runId !== this.workspaceRunId) return;
      if (result) {
        this.results.set(uri.toString(), result);
        incomplete ||= Boolean(result.skipped);
        if (result.findings.some(finding => finding.severity === "critical")) this.emit();
      } else {
        this.results.delete(uri.toString());
      }
      completed += 1;
      progress?.report({
        message: `${completed}/${uris.length}: ${relativePath(uri)}`,
        increment: uris.length > 0 ? 100 / uris.length : 100
      });
    });

    if (runId !== this.workspaceRunId) return this.snapshot();
    const cancelled = Boolean(token?.isCancellationRequested);
    this.scannedAt = new Date().toISOString();
    this.activity = "idle";
    this.coverage = cancelled || discovery.truncated || incomplete ? "partial" : "complete";
    this.lastScanReason = reason;
    this.lastScanFileCount = completed;
    this.emit();
    if (this.changes.size > 0) this.scheduleFlush();
    return this.snapshot();
  }

  public async scanFile(uri: vscode.Uri, notify = true): Promise<StoredFileResult | undefined> {
    if (!readSettings().enabled) return undefined;
    const result = await this.readFileResult(uri);
    if (result) this.results.set(uri.toString(), result);
    else this.results.delete(uri.toString());
    if (notify) {
      this.scannedAt = new Date().toISOString();
      this.lastScanReason = "current-file";
      this.lastScanFileCount = result ? 1 : 0;
      if (result?.skipped) this.coverage = "partial";
      this.emit();
    }
    return result;
  }

  public configureMonitoring(mode: AutomaticScanMode): void {
    const shouldMonitor = readSettings().enabled && mode === "live";
    const monitoringActive = this.monitoringDisposables.length > 0;
    if (this.monitoredMode === mode && shouldMonitor === monitoringActive) return;
    this.stopMonitoring();
    this.monitoredMode = mode;
    if (!shouldMonitor) {
      this.emit();
      return;
    }

    // String globs subscribe to VS Code's existing workspace watcher instead of
    // installing a recursive operating-system watcher for this extension.
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const queueScan = (uri: vscode.Uri): void => this.queueChange(uri, "scan");
    const queueDelete = (uri: vscode.Uri): void => this.queueChange(uri, "delete");
    this.monitoringDisposables.push(
      watcher,
      watcher.onDidCreate(queueScan),
      watcher.onDidChange(queueScan),
      watcher.onDidDelete(queueDelete),
      vscode.workspace.onDidSaveTextDocument(document => queueScan(document.uri))
    );
    this.emit();
  }

  private queueChange(uri: vscode.Uri, kind: PendingChangeKind): void {
    const path = relativePath(uri);
    const settings = readSettings();
    if (!settings.enabled || settings.automaticScanMode !== "live" || !isRelevantFile(path) || matchesAnyGlob(path, settings.exclude)) return;
    this.changes.upsert({ key: uri.toString(), value: uri, kind, priority: priorityForPath(path) });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.changeTimer || this.flushRunning) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      void this.flushChanges();
    }, CHANGE_DEBOUNCE_MS);
  }

  private async flushChanges(): Promise<void> {
    if (this.flushRunning) return;
    if (this.activity === "workspace") {
      this.scheduleFlush();
      return;
    }
    const batch = this.changes.drain();
    if (batch.length === 0) return;

    const monitoringRunId = this.monitoringRunId;
    const workspaceRunId = this.workspaceRunId;
    this.flushRunning = true;
    this.activeChangeCount = batch.length;
    this.activity = "changes";
    this.emit();
    let incomplete = false;
    await runWithConcurrency(batch, FILE_READ_CONCURRENCY, async change => {
      if (monitoringRunId !== this.monitoringRunId || workspaceRunId !== this.workspaceRunId) return;
      if (change.kind === "delete") {
        this.results.delete(change.key);
        return;
      }
      const result = await this.readFileResult(change.value);
      if (monitoringRunId !== this.monitoringRunId || workspaceRunId !== this.workspaceRunId) return;
      if (result) {
        this.results.set(change.key, result);
        incomplete ||= Boolean(result.skipped);
        if (result.findings.some(finding => finding.severity === "critical")) this.emit();
      } else {
        this.results.delete(change.key);
      }
    });
    if (monitoringRunId !== this.monitoringRunId || workspaceRunId !== this.workspaceRunId) {
      this.activeChangeCount = 0;
      this.flushRunning = false;
      if (this.activity === "changes") this.activity = "idle";
      this.emit();
      if (this.changes.size > 0) this.scheduleFlush();
      return;
    }
    this.scannedAt = new Date().toISOString();
    this.activity = "idle";
    this.lastScanReason = "changes";
    this.lastScanFileCount = batch.length;
    if (incomplete) this.coverage = "partial";
    this.activeChangeCount = 0;
    this.flushRunning = false;
    this.emit();
    if (this.changes.size > 0) this.scheduleFlush();
  }

  private async readFileResult(uri: vscode.Uri): Promise<StoredFileResult | undefined> {
    const settings = readSettings();
    const path = relativePath(uri);
    if (matchesAnyGlob(path, settings.exclude)) return undefined;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) return undefined;
      if (stat.size > settings.maxFileSizeBytes) {
        if (isSensitiveConfig(path)) {
          const urgent = /(?:^|\/)\.vscode\/(?:tasks|settings|launch)\.json$|(?:^|\/)\.devcontainer\/devcontainer\.json$/i.test(path);
          const fingerprint = `${path}:oversized:${stat.size}`;
          const review: Finding = {
            ruleId: "FG-CONFIG-OVERSIZED",
            title: "Large security configuration was not checked",
            description: `This file is ${stat.size.toLocaleString()} bytes, above the scan limit. Review it manually or increase the file-size limit.`,
            severity: urgent ? "high" : "review",
            confidence: urgent ? "medium" : "low",
            score: urgent ? 45 : 10,
            relativePath: path,
            position: { line: 0, character: 0 },
            length: 1,
            evidence: "File content not read.",
            fingerprint
          };
          return {
            uri,
            relativePath: path,
            findings: settings.allowlist.has(fingerprint) ? [] : [review],
            skipped: { relativePath: path, reason: "Oversized security-sensitive file requires manual review" }
          };
        }
        return { uri, relativePath: path, findings: [], skipped: { relativePath: path, reason: `Exceeds ${settings.maxFileSizeBytes.toLocaleString()} byte limit` } };
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      const envPotentiallyUnignored = isEnvironmentFile(path) ? await environmentFilePotentiallyUnignored(uri) : false;
      const analysis = analyzeFile({ relativePath: path, bytes, envPotentiallyUnignored });
      const findings = analysis.findings.filter(finding => !settings.allowlist.has(finding.fingerprint));
      return {
        uri,
        relativePath: path,
        findings,
        skipped: analysis.binary ? { relativePath: path, reason: "Binary content" } : undefined
      };
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "FileNotFound") return undefined;
      return { uri, relativePath: path, findings: [], skipped: { relativePath: path, reason: "Could not read file" } };
    }
  }

  private stopMonitoring(): void {
    this.monitoringRunId += 1;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = undefined;
    this.changes.clear();
    if (this.activity === "changes") this.activity = "idle";
    for (const disposable of this.monitoringDisposables.splice(0)) disposable.dispose();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  public dispose(): void {
    this.workspaceRunId += 1;
    this.stopMonitoring();
    this.listeners.clear();
  }
}
