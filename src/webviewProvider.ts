// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { getConfig } from './config';

interface NotesState {
  state: string;
  currentPage: number;
  pages: string[];
  version: number;
}

export default class SidebarMarkdownNotesProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'sidebarMarkdownNotes.webview';

  private _view?: vscode.WebviewView;

  private config = getConfig();

  private _watcher?: vscode.FileSystemWatcher;
  private _pendingWrites = new Set<string>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private _statusBar?: vscode.StatusBarItem
  ) {
    this._setupFileWatcher();
  }

  public dispose(): void {
    this._watcher?.dispose();
  }

  private _setupFileWatcher(): void {
    const dir = this.getStorageDirectory();
    if (!dir) { return; }
    this._createWatcherForDir(dir);
  }

  private _createWatcherForDir(dir: string): void {
    this._watcher?.dispose();
    const pattern = new vscode.RelativePattern(dir, 'page-*.md');
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this._watcher.onDidChange(uri => this._onFileChanged(uri));
  }

  private _onFileChanged(uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    if (this._pendingWrites.has(filePath)) {
      this._pendingWrites.delete(filePath);
      return;
    }
    // External change detected — reload the page content
    const fileName = path.basename(filePath);
    const match = fileName.match(/^page-(\d+)\.md$/);
    if (!match) { return; }
    const pageIndex = parseInt(match[1], 10) - 1;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (this._view) {
        this._view.webview.postMessage({ type: 'updatePage', pageIndex, content });
      }
    } catch { /* file may have been deleted */ }
  }

  private getStorageDirectory(): string | undefined {
    const config = vscode.workspace.getConfiguration('sidebar-markdown-notes');
    const dir = config.get<string>('storageDirectory', '');
    return dir || undefined;
  }

  private async ensureStorageDirectory(): Promise<string | undefined> {
    const dir = this.getStorageDirectory();
    if (!dir) { return undefined; }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public async loadStateFromDisk(): Promise<NotesState | undefined> {
    const dir = this.getStorageDirectory();
    if (!dir || !fs.existsSync(dir)) { return undefined; }

    const stateFile = path.join(dir, '_state.json');
    let currentPage = 0;
    let viewState = 'editor';

    if (fs.existsSync(stateFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        currentPage = meta.currentPage || 0;
        viewState = meta.state || 'editor';
      } catch { /* ignore corrupt state file */ }
    }

    // Read all page-*.md files
    const files = fs.readdirSync(dir).filter((f: string) => /^page-\d+\.md$/.test(f)).sort((a: string, b: string) => {
      const numA = parseInt(a.match(/\d+/)![0], 10);
      const numB = parseInt(b.match(/\d+/)![0], 10);
      return numA - numB;
    });

    if (files.length === 0) { return undefined; }

    const pages: string[] = [];
    for (const file of files) {
      const num = parseInt(file.match(/\d+/)![0], 10);
      pages[num - 1] = fs.readFileSync(path.join(dir, file), 'utf8');
    }

    // Fill any gaps with empty strings
    for (let i = 0; i < pages.length; i++) {
      if (pages[i] === undefined) { pages[i] = ''; }
    }

    return { state: viewState, currentPage, pages, version: 1 };
  }

  public async saveStateToDisk(state: NotesState): Promise<void> {
    const dir = await this.ensureStorageDirectory();
    if (!dir) { return; }

    // Write each page as a separate .md file
    for (let i = 0; i < state.pages.length; i++) {
      const filePath = path.join(dir, `page-${i + 1}.md`);
      this._pendingWrites.add(filePath);
      fs.writeFileSync(filePath, state.pages[i] || '', 'utf8');
    }

    // Remove any extra page files that no longer exist
    const existing = fs.readdirSync(dir).filter((f: string) => /^page-\d+\.md$/.test(f));
    for (const file of existing) {
      const num = parseInt(file.match(/\d+/)![0], 10);
      if (num > state.pages.length) {
        fs.unlinkSync(path.join(dir, file));
      }
    }

    // Write state metadata
    const stateFile = path.join(dir, '_state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ currentPage: state.currentPage, state: state.state }), 'utf8');
  }

  public async reloadFromDisk(): Promise<void> {
    this._setupFileWatcher();
    if (this._view) {
      const state = await this.loadStateFromDisk();
      if (state) {
        this._view.webview.postMessage({ type: 'loadData', value: state });
      }
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data: any) => {
      switch (data.type) {
        case 'log': {
          vscode.window.showInformationMessage(`${data.value}`);
          break;
        }
        case 'updateStatusBar': {
          this.updateStatusBar(data.value);
          break;
        }
        case 'saveData': {
          await this.saveStateToDisk(data.value as NotesState);
          break;
        }
        case 'requestLoad': {
          const state = await this.loadStateFromDisk();
          if (state) {
            webviewView.webview.postMessage({ type: 'loadData', value: state });
          }
          break;
        }
        case 'revealCurrentPage': {
          this.revealPageFile(data.currentPage);
          break;
        }
        case 'exportPage': {
          const dir = this.getStorageDirectory();
          if (dir && data.currentPage !== undefined) {
            const filePath = path.join(dir, `page-${data.currentPage + 1}.md`);
            if (fs.existsSync(filePath)) {
              const doc = await vscode.workspace.openTextDocument(filePath);
              await vscode.window.showTextDocument(doc, 1, false);
            } else {
              vscode.window.showWarningMessage('No file on disk for this page yet. Save some notes first.');
            }
          } else {
            vscode.window.showWarningMessage('Set a storage directory first (Command: "Set storage directory").');
          }
          break;
        }
      }
    });

    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (e.affectsConfiguration('sidebar-markdown-notes')) {
        this.config = getConfig();
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
      }
    });
  }

  public resetData() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'resetData' });
    }
  }

  public togglePreview() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'togglePreview' });
    }
  }

  public previousPage() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'previousPage' });
    }
  }

  public nextPage() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'nextPage' });
    }
  }

  public exportPage() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'exportPage' });
    }
  }

  public deletePage() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'deletePage' });
    }
  }

  public revealInExplorer() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'requestCurrentPage' });
    }
  }

  private revealPageFile(pageIndex: number) {
    const dir = this.getStorageDirectory();
    if (!dir) {
      vscode.window.showWarningMessage('Set a storage directory first (Command: "Set storage directory").');
      return;
    }
    const filePath = path.join(dir, `page-${pageIndex + 1}.md`);
    if (fs.existsSync(filePath)) {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
    } else {
      vscode.window.showWarningMessage('No file on disk for this page yet. Save some notes first.');
    }
  }

  public updateStatusBar(content?: string) {
    if (this._statusBar) {
      if (content) {
        this._statusBar.text = `${content}`;
        this._statusBar.show();
      } else {
        this._statusBar.hide();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const purifyUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'lib', 'purify.min.js'));

    const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'lib', 'marked.min.js'));

    const lodashUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'lib', 'lodash.min.js'));

    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

    // Do the same for the stylesheet.
    const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
    const markdownCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'markdown.css'));
    const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

    // Use a nonce to only allow a specific script to be run.
    const nonce = this._getNonce();

    const config = JSON.stringify({
      leftMargin: this.config.leftMargin,
      margin: this.config.margin
    });

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
          webview.cspSource
        }; script-src 'nonce-${nonce}';">

        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${markdownCss}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>Sidebar markdown notes</title>
			</head>
      <body>

        <div id="render"></div>
        <div id="content"><textarea id="text-input" name="text-input" placeholder="Start by typing your markdown notes..."></textarea></div>

        <script nonce="${nonce}">
          (function () {
            const renderElement = document.getElementById('render');
            const editorElement = document.getElementById('content');

            const effectiveLeftMargin = ${this.config.effectiveLeftMargin};
            const allSidesMargin = ${this.config.effectiveMargin};
            renderElement.style.paddingLeft = effectiveLeftMargin + 'px';
            editorElement.style.paddingLeft = effectiveLeftMargin + 'px';
            renderElement.style.paddingTop = allSidesMargin + 'px';
            renderElement.style.paddingRight = allSidesMargin + 'px';
            renderElement.style.paddingBottom = allSidesMargin + 'px';
            editorElement.style.paddingTop = allSidesMargin + 'px';
            editorElement.style.paddingRight = allSidesMargin + 'px';
            editorElement.style.paddingBottom = allSidesMargin + 'px';
          })();
        </script>
        <script nonce="${nonce}" src="${lodashUri}"></script>
        <script nonce="${nonce}" src="${purifyUri}"></script>
        <script nonce="${nonce}" src="${markedUri}"></script>
        <script nonce="${nonce}">var config = ${config};</script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
  }

  private _getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
