import * as vscode from 'vscode';
import { DraftsStore, DraftScope, PromptDraft } from './draftsStore';

type WebviewToExtMessage =
	| { type: 'ready' }
	| { type: 'setScope'; scope: DraftScope }
	| { type: 'setProject'; projectKey: string }
	| { type: 'requestDrafts' }
	| { type: 'insertDraft'; id: string }
	| { type: 'deleteDraft'; id: string }
	| { type: 'updateDraft'; id: string; text: string }
	| { type: 'createDraft'; text: string };

type ExtToWebviewMessage =
	| {
			type: 'state';
			scope: DraftScope;
			projects: { key: string; name: string }[];
			projectKey: string | null;
			drafts: PromptDraft[];
		}
	| { type: 'status'; message: string }
	| { type: 'error'; message: string };

const SCOPE_KEY = 'promptDrafts.scope';
const PROJECT_KEY = 'promptDrafts.projectKey';

export class PromptManagerController {
	private scope: DraftScope;
	private projectKey: string | null;
	private webview?: vscode.Webview;

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly store: DraftsStore
	) {
		this.scope = (this.context.globalState.get<DraftScope>(SCOPE_KEY) ?? 'global');
		this.projectKey = this.context.globalState.get<string>(PROJECT_KEY) ?? null;
	}

	public attach(webview: vscode.Webview): void {
		this.webview = webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		webview.html = this.getHtml(webview);

		webview.onDidReceiveMessage(async (raw: WebviewToExtMessage) => {
			try {
				await this.onMessage(raw);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.postMessage({ type: 'error', message });
			}
		});

		this.postState();
	}

	private async onMessage(message: WebviewToExtMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
			case 'requestDrafts':
				this.postState();
				return;
			case 'setScope':
				this.scope = message.scope;
				if (this.scope === 'project') {
					const projects = this.store.getProjects();
					if (projects.length === 0) {
						this.scope = 'global';
						await this.context.globalState.update(SCOPE_KEY, this.scope);
						this.postMessage({
							type: 'error',
							message: 'Open a folder/workspace to use Project scope',
						});
						this.postState();
						return;
					}
					this.ensureProjectSelected();
				}
				await this.context.globalState.update(SCOPE_KEY, this.scope);
				this.postState();
				return;
			case 'setProject':
				this.projectKey = message.projectKey;
				await this.context.globalState.update(PROJECT_KEY, this.projectKey);
				this.postState();
				return;
			case 'insertDraft': {
				const draft = this.getDraftsForCurrentSelection().find((d) => d.id === message.id);
				if (!draft) {
					return;
				}
				await insertIntoActiveEditor(draft.text);
				return;
			}
			case 'deleteDraft':
				await this.deleteDraftForCurrentSelection(message.id);
				this.postState();
				this.postStatus('Deleted');
				return;
			case 'updateDraft':
				await this.updateDraftForCurrentSelection(message.id, message.text);
				this.postState();
				this.postStatus('Saved');
				return;
			case 'createDraft':
				await this.addDraftForCurrentSelection(message.text);
				this.postState();
				this.postStatus(`Created (${this.getDraftsForCurrentSelection().length} drafts)`);
				return;
		}
	}

	private ensureProjectSelected(): void {
		const projects = this.store.getProjects();
		if (projects.length === 0) {
			this.projectKey = null;
			return;
		}
		if (this.projectKey && projects.some((p) => p.key === this.projectKey)) {
			return;
		}
		this.projectKey = projects[0].key;
		void this.context.globalState.update(PROJECT_KEY, this.projectKey);
	}

	private getDraftsForCurrentSelection(): PromptDraft[] {
		if (this.scope === 'global') {
			return this.store.getDrafts('global');
		}
		this.ensureProjectSelected();
		if (!this.projectKey) {
			return [];
		}
		return this.store.getProjectDrafts(this.projectKey);
	}

	private async addDraftForCurrentSelection(text: string): Promise<void> {
		if (this.scope === 'global') {
			await this.store.addDraft('global', text);
			return;
		}
		this.ensureProjectSelected();
		if (!this.projectKey) {
			throw new Error('Open a folder/workspace to create project drafts');
		}
		await this.store.addProjectDraft(this.projectKey, text);
	}

	private async updateDraftForCurrentSelection(id: string, text: string): Promise<void> {
		if (this.scope === 'global') {
			await this.store.updateDraft('global', id, text);
			return;
		}
		this.ensureProjectSelected();
		if (!this.projectKey) {
			throw new Error('Open a folder/workspace to edit project drafts');
		}
		await this.store.updateProjectDraft(this.projectKey, id, text);
	}

	private async deleteDraftForCurrentSelection(id: string): Promise<void> {
		if (this.scope === 'global') {
			await this.store.deleteDraft('global', id);
			return;
		}
		this.ensureProjectSelected();
		if (!this.projectKey) {
			throw new Error('Open a folder/workspace to delete project drafts');
		}
		await this.store.deleteProjectDraft(this.projectKey, id);
	}

	private postState(): void {
		const projects = this.store.getProjects();
		if (this.scope === 'project' && projects.length === 0) {
			this.scope = 'global';
			void this.context.globalState.update(SCOPE_KEY, this.scope);
		}
		if (this.scope === 'project') {
			this.ensureProjectSelected();
		}
		const drafts = this.getDraftsForCurrentSelection();
		this.postMessage({
			type: 'state',
			scope: this.scope,
			projects,
			projectKey: this.projectKey,
			drafts,
		});
	}

	private postMessage(message: ExtToWebviewMessage): void {
		this.webview?.postMessage(message);
	}

	private postStatus(message: string): void {
		this.postMessage({ type: 'status', message });
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'promptManager.js')
		);

		return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Prompt Drafts</title>
		<style>
			body {
				padding: 0;
				margin: 0;
				color: var(--vscode-foreground);
				background: var(--vscode-sideBar-background);
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
			}
			.container { padding: 10px; }
			.row { display: flex; gap: 8px; align-items: center; }
			.row.space { justify-content: space-between; }
			select, button, textarea, input {
				color: var(--vscode-foreground);
				background: var(--vscode-input-background);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 6px;
			}
			button {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border: 1px solid var(--vscode-button-background);
				cursor: pointer;
			}
			button.secondary {
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				border: 1px solid var(--vscode-button-secondaryBackground);
			}
			button.danger {
				background: var(--vscode-inputValidation-errorBackground);
				color: var(--vscode-foreground);
				border: 1px solid var(--vscode-inputValidation-errorBorder);
			}
			textarea {
				width: 100%;
				min-height: 90px;
				resize: vertical;
				box-sizing: border-box;
			}
			.hr { height: 1px; background: var(--vscode-sideBar-border); margin: 10px 0; }
			.small { opacity: 0.8; font-size: 0.9em; }
			.list { display: flex; flex-direction: column; gap: 8px; }
			.card {
				border: 1px solid var(--vscode-sideBar-border);
				border-radius: 6px;
				padding: 8px;
				background: var(--vscode-editor-background);
			}
			.cardTitle { font-weight: 600; margin-bottom: 6px; }
			.cardActions { display: flex; gap: 6px; flex-wrap: wrap; }
			.muted { opacity: 0.75; }
		</style>
	</head>
	<body>
		<div class="container">
			<div class="row space">
				<div class="row" style="flex: 1;">
					<span class="small">Scope</span>
					<select id="scope">
						<option value="project">Project</option>
						<option value="global">Global</option>
					</select>
					<span class="small" style="margin-left: 6px;">Project</span>
					<select id="project" style="flex: 1;"></select>
				</div>
				<button id="refresh" class="secondary" type="button">Refresh</button>
			</div>

			<div class="hr"></div>

			<div class="row" style="margin-bottom: 6px;">
				<span class="small">Editor (auto-saves every 2s)</span>
			</div>
			<textarea id="editor" placeholder="Select a draft to edit, or type and click Create"></textarea>
			<div class="row" style="margin-top: 8px; justify-content: space-between;">
				<div class="row">
					<button id="create" type="button">Create</button>
					<button id="clear" class="secondary" type="button">Clear</button>
				</div>
				<div class="small muted" id="status">Loading…</div>
			</div>

			<div class="hr"></div>

			<div class="row" style="margin-bottom: 6px;">
				<span class="small">Drafts</span>
			</div>
			<div id="list" class="list"></div>
		</div>

		<script src="${scriptUri}"></script>
	</body>
</html>`;
	}
}

async function insertIntoActiveEditor(text: string): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('Open an editor first');
		return;
	}

	await editor.insertSnippet(new vscode.SnippetString(text));
}

function createNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
