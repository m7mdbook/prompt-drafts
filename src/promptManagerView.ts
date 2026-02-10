import * as vscode from 'vscode';
import { DraftsStore, DraftScope, PromptDraft } from './draftsStore';

type WebviewToExtMessage =
	| { type: 'ready' }
	| { type: 'setScope'; scope: DraftScope }
	| { type: 'requestDrafts' }
	| { type: 'insertDraft'; id: string }
	| { type: 'deleteDraft'; id: string }
	| { type: 'updateDraft'; id: string; text: string }
	| { type: 'createDraft'; text: string };

type ExtToWebviewMessage =
	| { type: 'state'; scope: DraftScope; drafts: PromptDraft[] }
	| { type: 'error'; message: string };

const SCOPE_KEY = 'promptDrafts.scope';

export class PromptManagerViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'promptDrafts.manager';

	private view?: vscode.WebviewView;
	private scope: DraftScope;

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly store: DraftsStore
	) {
		this.scope = (this.context.globalState.get<DraftScope>(SCOPE_KEY) ?? 'global');
	}

	public resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
		};
		view.webview.html = this.getHtml(view.webview);

		view.webview.onDidReceiveMessage(async (raw: WebviewToExtMessage) => {
			try {
				await this.onMessage(raw);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.postMessage({ type: 'error', message });
			}
		});

		this.postState();
	}

	public reveal(): void {
		this.view?.show?.(true);
	}

	private async onMessage(message: WebviewToExtMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
			case 'requestDrafts':
				this.postState();
				return;
			case 'setScope':
				this.scope = message.scope;
				await this.context.globalState.update(SCOPE_KEY, this.scope);
				this.postState();
				return;
			case 'insertDraft': {
				const draft = this.store.getDrafts(this.scope).find((d) => d.id === message.id);
				if (!draft) {
					return;
				}
				await insertIntoActiveEditor(draft.text);
				return;
			}
			case 'deleteDraft':
				await this.store.deleteDraft(this.scope, message.id);
				this.postState();
				return;
			case 'updateDraft':
				await this.store.updateDraft(this.scope, message.id, message.text);
				this.postState();
				return;
			case 'createDraft':
				await this.store.addDraft(this.scope, message.text);
				this.postState();
				return;
		}
	}

	private postState(): void {
		this.postMessage({
			type: 'state',
			scope: this.scope,
			drafts: this.store.getDrafts(this.scope),
		});
	}

	private postMessage(message: ExtToWebviewMessage): void {
		this.view?.webview.postMessage(message);
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = createNonce();

		return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
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
			label { display: inline-flex; gap: 6px; align-items: center; }
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
				<div class="row">
					<span class="small">Scope</span>
					<select id="scope">
						<option value="project">Project</option>
						<option value="global">Global</option>
					</select>
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
				<div class="small muted" id="status"></div>
			</div>

			<div class="hr"></div>

			<div class="row" style="margin-bottom: 6px;">
				<span class="small">Drafts</span>
			</div>
			<div id="list" class="list"></div>
		</div>

		<script nonce="${nonce}">
			const vscode = acquireVsCodeApi();

			/** @type {'project'|'global'} */
			let scope = 'global';
			/** @type {{id:string,text:string,createdAt:number,updatedAt:number}[]} */
			let drafts = [];
			/** @type {string|null} */
			let editingId = null;
			let lastEditedText = '';
			let lastAutosaveAt = 0;

			const scopeSelect = document.getElementById('scope');
			const refreshBtn = document.getElementById('refresh');
			const editor = document.getElementById('editor');
			const list = document.getElementById('list');
			const createBtn = document.getElementById('create');
			const clearBtn = document.getElementById('clear');
			const status = document.getElementById('status');

			function post(message) {
				vscode.postMessage(message);
			}

			function setStatus(text) {
				status.textContent = text;
			}

			function summarize(text) {
				const firstLine = (text || '').split(/\r?\n/)[0];
				if (!firstLine) return '(empty)';
				return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
			}

			function render() {
				scopeSelect.value = scope;
				list.textContent = '';

				if (!drafts.length) {
					const empty = document.createElement('div');
					empty.className = 'small muted';
					empty.textContent = 'No drafts yet. Use Create above, or run the Save Prompt Draft command.';
					list.appendChild(empty);
					return;
				}

				for (const d of drafts) {
					const card = document.createElement('div');
					card.className = 'card';

					const title = document.createElement('div');
					title.className = 'cardTitle';
					title.textContent = summarize(d.text);
					card.appendChild(title);

					const actions = document.createElement('div');
					actions.className = 'cardActions';

					const insert = document.createElement('button');
					insert.type = 'button';
					insert.textContent = 'Insert';
					insert.addEventListener('click', () => post({ type: 'insertDraft', id: d.id }));

					const edit = document.createElement('button');
					edit.type = 'button';
					edit.className = 'secondary';
					edit.textContent = editingId === d.id ? 'Editing' : 'Edit';
					edit.addEventListener('click', () => {
						editingId = d.id;
						editor.value = d.text;
						lastEditedText = d.text;
						setStatus('Editing draft');
						render();
					});

					const del = document.createElement('button');
					del.type = 'button';
					del.className = 'danger';
					del.textContent = 'Delete';
					del.addEventListener('click', () => post({ type: 'deleteDraft', id: d.id }));

					actions.appendChild(insert);
					actions.appendChild(edit);
					actions.appendChild(del);
					card.appendChild(actions);
					list.appendChild(card);
				}
			}

			scopeSelect.addEventListener('change', () => {
				scope = scopeSelect.value;
				editingId = null;
				editor.value = '';
				lastEditedText = '';
				post({ type: 'setScope', scope });
			});

			refreshBtn.addEventListener('click', () => post({ type: 'requestDrafts' }));

			createBtn.addEventListener('click', () => {
				const text = editor.value || '';
				if (!text.trim()) {
					setStatus('Nothing to create');
					return;
				}
				post({ type: 'createDraft', text });
				editingId = null;
				editor.value = '';
				lastEditedText = '';
				setStatus('Created');
			});

			clearBtn.addEventListener('click', () => {
				editingId = null;
				editor.value = '';
				lastEditedText = '';
				setStatus('Cleared');
				render();
			});

			// Autosave edited draft every 2 seconds (only when editing an existing draft)
			setInterval(() => {
				if (!editingId) return;
				const text = editor.value || '';
				if (text === lastEditedText) return;
				const now = Date.now();
				if (now - lastAutosaveAt < 1800) return;

				lastEditedText = text;
				lastAutosaveAt = now;
				post({ type: 'updateDraft', id: editingId, text });
				setStatus('Auto-saved');
			}, 500);

			window.addEventListener('message', (event) => {
				const message = event.data;
				if (!message || !message.type) return;

				if (message.type === 'state') {
					scope = message.scope;
					drafts = message.drafts;

					// keep editing buffer in sync if the draft moved/updated
					if (editingId) {
						const edited = drafts.find((d) => d.id === editingId);
						if (!edited) {
							editingId = null;
							editor.value = '';
							lastEditedText = '';
						} else if (editor.value !== edited.text && editor.value === lastEditedText) {
							editor.value = edited.text;
							lastEditedText = edited.text;
						}
					}

					render();
					return;
				}

				if (message.type === 'error') {
					setStatus(message.message);
					return;
				}
			});

			post({ type: 'ready' });
		</script>
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
