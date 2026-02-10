import * as vscode from 'vscode';
import { DraftsStore } from './draftsStore';
import { PromptManagerController } from './promptManagerController';

export class PromptManagerPanel {
	private static current?: PromptManagerPanel;

	public static createOrShow(context: vscode.ExtensionContext, store: DraftsStore): void {
		const existing = PromptManagerPanel.current;
		if (existing) {
			existing.panel.reveal(vscode.ViewColumn.Beside);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'promptDrafts.managerPanel',
			'Prompt Drafts',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
			{ enableScripts: true }
		);

		PromptManagerPanel.current = new PromptManagerPanel(panel, new PromptManagerController(context, store));
	}

	private constructor(
		public readonly panel: vscode.WebviewPanel,
		private readonly controller: PromptManagerController
	) {
		this.controller.attach(panel.webview);
		panel.onDidDispose(() => {
			PromptManagerPanel.current = undefined;
		});
	}
}
