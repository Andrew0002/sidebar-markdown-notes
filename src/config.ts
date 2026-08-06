import * as vscode from 'vscode';

class Config {
  private readonly config: vscode.WorkspaceConfiguration;

  constructor() {
    this.config = vscode.workspace.getConfiguration('sidebar-markdown-notes');
  }

  get leftMargin() {
    return !!this.config.get('leftMargin', true);
  }

  get margin(): number {
    return this.config.get<number>('margin', 12);
  }

  get effectiveLeftMargin(): number {
    const fromLeftMargin = this.leftMargin ? 20 : 0;
    return Math.max(fromLeftMargin, this.margin);
  }

  get effectiveMargin(): number {
    return this.margin;
  }
}

export function getConfig() {
  return new Config();
}
