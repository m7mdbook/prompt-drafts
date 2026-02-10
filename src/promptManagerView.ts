import * as vscode from 'vscode';
import { DraftsStore } from './draftsStore';
import { PromptManagerController } from './promptManagerController';

export class PromptManagerViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'promptDrafts.manager';

	private view?: vscode.WebviewView;
	private readonly controller: PromptManagerController;

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly store: DraftsStore
	) {
		this.controller = new PromptManagerController(this.context, this.store);
	}

	public resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		this.controller.attach(view.webview);
	}

	public reveal(): void {
		this.view?.show?.(true);
	}

}
