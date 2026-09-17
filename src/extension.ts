import * as vscode from "vscode";
import type { Finding } from "./scanner/types";
import { isRelevantFile } from "./scanner/paths";
import { exportJsonReport } from "./report/export";
import { CriticalNotifications } from "./ui/notifications";
import { ControlCenterProvider, type FindingAction } from "./ui/control-center";
import { FindingDiagnostics } from "./ui/diagnostics";
import { GuardStatus } from "./ui/status";
import { type FindingNode, FindingsTree } from "./ui/tree";
import { relativePath } from "./workspace/discovery";
import { findingExclusionChoices, type FindingExclusionChoice } from "./workspace/exclusions";
import { matchesAnyGlob } from "./workspace/glob";
import { WorkspaceScanner } from "./workspace/scanner";
import { addGlobalAllowlistFingerprint, readManagedWorkspaceExclusions, readSettings, setGlobalAutomaticScanMode, setManagedWorkspaceExclusions, type AutomaticScanMode } from "./workspace/settings";

interface FindingExclusionQuickPickItem extends vscode.QuickPickItem {
  readonly choice: FindingExclusionChoice;
}

export function activate(context: vscode.ExtensionContext): void {
  const managedExclusionsKey = "frontendGuard.managedWorkspaceExclusions";
  setManagedWorkspaceExclusions(context.workspaceState.get<readonly string[]>(managedExclusionsKey, []));
  const scanner = new WorkspaceScanner();
  const diagnostics = new FindingDiagnostics();
  const status = new GuardStatus();
  const tree = new FindingsTree();
  const notifications = new CriticalNotifications(context);
  const view = vscode.window.createTreeView("frontendGuard.findings", { treeDataProvider: tree, showCollapseAll: true });

  const openFinding = async (finding: Finding, uri?: vscode.Uri): Promise<void> => {
    const file = uri ?? scanner.snapshot().files.find(candidate => candidate.relativePath === finding.relativePath)?.uri;
    if (!file) return;
    const document = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const start = new vscode.Position(finding.position.line, finding.position.character);
    const range = new vscode.Range(start, start.translate(0, Math.max(1, finding.length)));
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  const applySnapshot = (snapshot: ReturnType<WorkspaceScanner["snapshot"]>): void => {
    diagnostics.update(snapshot);
    tree.update(snapshot);
    status.update(snapshot);
    controlCenter.update(snapshot);
    notifications.update(snapshot, openFinding);
  };

  const scanWorkspace = async (): Promise<void> => {
    status.scanning();
    controlCenter.scanning();
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Codebase Guard: scanning workspace without running code",
      cancellable: true
    }, (progress, token) => scanner.scanWorkspace("manual", token, progress));
  };

  const scanCurrentFile = async (): Promise<void> => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || !vscode.workspace.getWorkspaceFolder(uri)) {
      void vscode.window.showInformationMessage("Open a workspace file to scan it.");
      return;
    }
    await scanner.scanFile(uri);
  };

  const showFindings = async (): Promise<void> => {
    await vscode.commands.executeCommand("frontendGuard.findings.focus");
  };

  const exportReport = async (): Promise<void> => {
    await exportJsonReport(scanner.snapshot());
  };

  const applyExclusion = async (choice: FindingExclusionChoice, critical = false): Promise<void> => {
    if (critical) {
      const scope = choice.kind === "file" ? "this file" : `the ${choice.path} folder`;
      const confirmation = await vscode.window.showWarningMessage(
        `Codebase Guard considers this finding Critical. Skipping ${scope} can hide malicious code from future scans.`,
        { modal: true },
        choice.kind === "file" ? "Skip File" : "Skip Folder"
      );
      if (!confirmation) return;
    }

    const existing = readManagedWorkspaceExclusions();
    const updated = setManagedWorkspaceExclusions([...existing, choice.pattern]);
    if (updated.length === existing.length) {
      void vscode.window.showInformationMessage(`${choice.path} is already skipped in this codebase.`);
      return;
    }
    await context.workspaceState.update(managedExclusionsKey, updated);
    void vscode.window.showInformationMessage(`Codebase Guard will skip ${choice.path} in this codebase and is rescanning.`);
    await scanWorkspace();
  };

  const skipFindingSource = async (node: FindingNode): Promise<void> => {
    if (!node?.finding || !node.uri) return;
    const choices = findingExclusionChoices(node.finding.relativePath);
    const items: FindingExclusionQuickPickItem[] = choices.map(choice => ({
      label: choice.kind === "file" ? "$(file) Skip only this file" : `$(folder) Skip folder: ${choice.path}`,
      description: choice.kind === "file" ? "File" : "Folder and everything below it",
      detail: choice.kind === "file" ? choice.path : `Excludes ${choice.pattern}`,
      choice
    }));
    const selected = await vscode.window.showQuickPick(items, {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "Choose the exact file or any parent folder",
      title: `Codebase Guard: skip source for ${node.finding.relativePath}`
    });
    if (!selected) return;

    await applyExclusion(selected.choice, node.finding.severity === "critical");
  };

  const ignoreFinding = async (finding: Finding, uri: vscode.Uri): Promise<void> => {
    if (finding.severity === "critical") {
      const confirmation = await vscode.window.showWarningMessage(
        "Codebase Guard considers this finding Critical. Hiding it can conceal malicious code in this workspace.",
        { modal: true }, "I Reviewed It — Hide Alert"
      );
      if (confirmation !== "I Reviewed It — Hide Alert") return;
    }
    await addGlobalAllowlistFingerprint(finding.fingerprint);
    await scanner.scanFile(uri);
  };

  const findingAction = async (action: FindingAction, fingerprint: string): Promise<void> => {
    const file = scanner.snapshot().files.find(candidate => candidate.findings.some(finding => finding.fingerprint === fingerprint));
    const finding = file?.findings.find(candidate => candidate.fingerprint === fingerprint);
    if (!file || !finding) {
      void vscode.window.showInformationMessage("That finding is no longer active. Run Scan again to refresh the results.");
      return;
    }
    if (action === "open") {
      await openFinding(finding, file.uri);
      return;
    }
    if (action === "ignore") {
      await ignoreFinding(finding, file.uri);
      return;
    }
    const choices = findingExclusionChoices(finding.relativePath);
    if (action === "skipFile") {
      const fileChoice = choices.find(choice => choice.kind === "file");
      if (fileChoice) await applyExclusion(fileChoice, finding.severity === "critical");
      return;
    }
    const folders = choices.filter(choice => choice.kind === "folder");
    if (folders.length === 0) return;
    const selected = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
      folders.map(choice => ({
        label: `$(folder) ${choice.path}`,
        description: "Folder and everything below it",
        detail: `Excludes ${choice.pattern}`,
        choice
      })),
      { matchOnDescription: true, matchOnDetail: true, title: `Codebase Guard: choose a folder to skip`, placeHolder: finding.relativePath }
    ).then(item => item?.choice);
    if (selected) await applyExclusion(selected, finding.severity === "critical");
  };

  const skipCurrent = async (kind: "file" | "folder"): Promise<void> => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || !vscode.workspace.getWorkspaceFolder(uri)) {
      void vscode.window.showInformationMessage("Open a workspace file before skipping it.");
      return;
    }
    const path = relativePath(uri);
    const slash = path.lastIndexOf("/");
    const choice: FindingExclusionChoice | undefined = kind === "file"
      ? { kind: "file", path, pattern: path }
      : slash > 0
        ? { kind: "folder", path: path.slice(0, slash), pattern: `${path.slice(0, slash)}/**` }
        : undefined;
    if (!choice) {
      void vscode.window.showInformationMessage("The current file is at the workspace root, so it has no parent folder to skip.");
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Skip ${choice.kind === "file" ? "file" : "folder"} ${choice.path}? Future scans will not inspect it.`,
      { modal: true },
      choice.kind === "file" ? "Skip File" : "Skip Folder"
    );
    if (!confirmation) return;
    await applyExclusion(choice);
  };

  const configureExclusions = async (): Promise<void> => {
    const existing = readManagedWorkspaceExclusions();
    const operation = await vscode.window.showQuickPick([
      {
        label: "$(add) Add files or folders",
        description: "Search inside the opened codebase",
        value: "add" as const
      },
      ...(existing.length > 0 ? [{
        label: "$(remove) Remove skipped items",
        description: `${existing.length} codebase exclusion${existing.length === 1 ? "" : "s"} configured`,
        value: "remove" as const
      }] : [])
    ], { placeHolder: "Manage files and folders skipped in this codebase" });
    if (!operation) return;

    if (operation.value === "remove") {
      const selected = await vscode.window.showQuickPick(
        existing.map(exclusion => ({
          label: `${exclusion.endsWith("/**") ? "$(folder)" : "$(file)"} ${exclusion.replace(/\/\*\*$/, "")}`,
          description: exclusion.endsWith("/**") ? "Folder" : "File",
          exclusion
        })),
        { canPickMany: true, matchOnDescription: true, placeHolder: "Select skipped items to restore" }
      );
      if (!selected || selected.length === 0) return;
      const removed = new Set(selected.map(item => item.exclusion));
      const updated = setManagedWorkspaceExclusions(existing.filter(exclusion => !removed.has(exclusion)));
      await context.workspaceState.update(managedExclusionsKey, updated);
      void vscode.window.showInformationMessage(`Codebase Guard restored ${removed.size} skipped item${removed.size === 1 ? "" : "s"} and is rescanning.`);
      await scanWorkspace();
      return;
    }

    if (!vscode.workspace.workspaceFolders?.length) {
      void vscode.window.showInformationMessage("Open a codebase before choosing files or folders to skip.");
      return;
    }

    const discovered = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Codebase Guard: indexing codebase…" },
      async () => {
        const [files, hooks] = await Promise.all([
          vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/coverage/**,**/.next/**,**/.nuxt/**,**/vendor/**,**/target/**,**/.cache/**,**/.turbo/**}", 10000),
          vscode.workspace.findFiles("**/.git/hooks/*", null, 500)
        ]);
        return [...files, ...hooks];
      }
    );

    const effectiveExclusions = readSettings().exclude;
    const filePaths = [...new Set(discovered.map(relativePath).filter(isRelevantFile))]
      .filter(path => !matchesAnyGlob(path, effectiveExclusions))
      .sort((left, right) => left.localeCompare(right));
    const folderPaths = new Set<string>();
    for (const path of filePaths) {
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index += 1) folderPaths.add(parts.slice(0, index).join("/"));
    }

    interface ExclusionCandidate extends vscode.QuickPickItem { readonly pattern: string; readonly path: string; readonly itemType: "folder" | "file"; }
    const candidates: ExclusionCandidate[] = [
      ...[...folderPaths]
        .filter(path => !matchesAnyGlob(`${path}/__frontend_guard__`, effectiveExclusions))
        .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))
        .map(path => ({ label: `$(folder) ${path}`, description: "Folder", pattern: `${path}/**`, path, itemType: "folder" as const })),
      ...filePaths.map(path => ({ label: `$(file) ${path}`, description: "File", pattern: path, path, itemType: "file" as const }))
    ];
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage("No additional scannable files or folders are available to skip.");
      return;
    }

    const selected = await vscode.window.showQuickPick(candidates, {
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "Search this codebase, then select files or folders to skip",
      title: "Codebase Guard: skip codebase items"
    });
    if (!selected?.length) return;

    const selectedFolders = selected.filter(item => item.itemType === "folder").map(item => item.path);
    const selectedPatterns = selected
      .filter(item => item.itemType === "folder" || !selectedFolders.some(folder => item.path.startsWith(`${folder}/`)))
      .map(item => item.pattern);
    const updated = setManagedWorkspaceExclusions([...existing, ...selectedPatterns]);
    await context.workspaceState.update(managedExclusionsKey, updated);
    void vscode.window.showInformationMessage(`Codebase Guard will skip ${selectedPatterns.length} selected item${selectedPatterns.length === 1 ? "" : "s"} in this codebase and is rescanning.`);
    await scanWorkspace();
  };

  const controlCenter = new ControlCenterProvider(context.extensionUri, {
    scanWorkspace,
    scanCurrentFile,
    showFindings,
    exportReport,
    configureExclusions,
    findingAction,
    skipCurrent,
    setAutomaticScanMode: async (mode: AutomaticScanMode) => {
      await setGlobalAutomaticScanMode(mode);
    },
    openSettings: async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:mh-jsx.frontend-guard");
    }
  });

  context.subscriptions.push(
    scanner,
    diagnostics,
    status,
    tree,
    view,
    controlCenter,
    vscode.window.registerWebviewViewProvider("frontendGuard.controlCenter", controlCenter),
    scanner.onDidChange(applySnapshot),
    vscode.commands.registerCommand("frontendGuard.scanWorkspace", scanWorkspace),
    vscode.commands.registerCommand("frontendGuard.scanCurrentFile", scanCurrentFile),
    vscode.commands.registerCommand("frontendGuard.showFindings", showFindings),
    vscode.commands.registerCommand("frontendGuard.exportJson", exportReport),
    vscode.commands.registerCommand("frontendGuard.configureExclusions", configureExclusions),
    vscode.commands.registerCommand("frontendGuard.skipFindingSource", skipFindingSource),
    vscode.commands.registerCommand("frontendGuard.openFinding", async (node: FindingNode) => {
      if (node?.finding && node.uri) await openFinding(node.finding, node.uri);
    }),
    vscode.commands.registerCommand("frontendGuard.ignoreFinding", async (node: FindingNode) => {
      if (node?.finding && node.uri) await ignoreFinding(node.finding, node.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => controlCenter.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => controlCenter.refresh()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("frontendGuard")) return;
      const settings = readSettings();
      scanner.configureMonitoring(settings.automaticScanMode);
      applySnapshot(scanner.snapshot());
      if (!settings.enabled) void scanner.scanWorkspace("manual");
      else if (settings.automaticScanMode !== "manual") void scanWorkspace();
    })
  );

  const initialSettings = readSettings();
  scanner.configureMonitoring(initialSettings.automaticScanMode);
  if (initialSettings.enabled && initialSettings.automaticScanMode !== "manual" && vscode.workspace.workspaceFolders?.length) {
    status.scanning();
    controlCenter.scanning();
    void scanner.scanWorkspace("startup");
  } else {
    applySnapshot(scanner.snapshot());
  }
}

export function deactivate(): void {
  // Disposables registered in ExtensionContext perform all cleanup.
}
