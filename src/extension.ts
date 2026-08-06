import * as vscode from 'vscode';
import SidebarMarkdownNotesProvider from './webviewProvider';

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  context.subscriptions.push(statusBar);

  const provider = new SidebarMarkdownNotesProvider(context.extensionUri, context, statusBar);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarMarkdownNotesProvider.viewId, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.togglePreview', () => {
      provider.togglePreview();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.previousPage', () => {
      provider.previousPage();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.nextPage', () => {
      provider.nextPage();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.resetData', () => {
      provider.resetData();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.exportPage', () => {
      provider.exportPage();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.deletePage', () => {
      provider.deletePage();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.revealInFinder', () => {
      provider.revealInExplorer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.revealInFileExplorer', () => {
      provider.revealInExplorer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sidebar-markdown-notes.setStorageDirectory', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Notes Storage Directory'
      });
      if (uris && uris.length > 0) {
        const config = vscode.workspace.getConfiguration('sidebar-markdown-notes');
        await config.update('storageDirectory', uris[0].fsPath, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Notes will be stored in: ${uris[0].fsPath}`);
        provider.reloadFromDisk();
      }
    })
  );

  // Prompt on first run if no storage directory is configured
  const config = vscode.workspace.getConfiguration('sidebar-markdown-notes');
  if (!config.get<string>('storageDirectory')) {
    vscode.window.showInformationMessage(
      'Sidebar Markdown Notes: Set a storage directory so your notes are saved to disk.',
      'Choose Directory'
    ).then(choice => {
      if (choice === 'Choose Directory') {
        vscode.commands.executeCommand('sidebar-markdown-notes.setStorageDirectory');
      }
    });
  }
}

export function deactivate() {}
