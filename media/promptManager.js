// Webview script for Prompt Drafts manager
// Uses VS Code theme colors via CSS variables.

(() => {
	/** @type {import('vscode-webview').WebviewApi<any>} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	const status = /** @type {HTMLElement} */ (document.getElementById('status'));
	function setStatus(text) {
		status.textContent = text;
	}

	window.addEventListener('error', (e) => {
		setStatus('JS error: ' + ((e && e.message) || e.type));
	});
	window.addEventListener('unhandledrejection', (e) => {
		const msg = e && e.reason ? (e.reason.message || String(e.reason)) : 'unknown';
		setStatus('Promise error: ' + msg);
	});

	/** @type {'project'|'global'} */
	let scope = 'global';
	/** @type {{key:string,name:string}[]} */
	let projects = [];
	/** @type {string|null} */
	let projectKey = null;
	/** @type {{id:string,text:string,createdAt:number,updatedAt:number}[]} */
	let drafts = [];
	/** @type {string|null} */
	let editingId = null;
	let lastEditedText = '';
	let lastAutosaveAt = 0;
	let pendingCreate = false;

	const scopeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('scope'));
	const projectSelect = /** @type {HTMLSelectElement} */ (document.getElementById('project'));
	const refreshBtn = /** @type {HTMLButtonElement} */ (document.getElementById('refresh'));
	const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
	const list = /** @type {HTMLDivElement} */ (document.getElementById('list'));
	const createBtn = /** @type {HTMLButtonElement} */ (document.getElementById('create'));
	const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear'));

	function post(message) {
		vscode.postMessage(message);
	}

	function summarize(text) {
		const firstLine = (text || '').split(/\r?\n/)[0];
		if (!firstLine) return '(empty)';
		return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
	}

	function render() {
		const hasProjects = projects.length > 0;

		// If there are no workspace folders, Project scope can't work.
		if (!hasProjects && scope === 'project') {
			scope = 'global';
			projectKey = null;
		}

		scopeSelect.value = scope;
		projectSelect.textContent = '';
		projectSelect.disabled = scope !== 'project' || !hasProjects;

		const projectOption = scopeSelect.querySelector('option[value="project"]');
		if (projectOption) {
			projectOption.disabled = !hasProjects;
		}

		if (!hasProjects) {
			const opt = document.createElement('option');
			opt.value = '';
			opt.textContent = 'No workspace folder (open a folder to use Project scope)';
			projectSelect.appendChild(opt);
		}

		for (const p of projects) {
			const opt = document.createElement('option');
			opt.value = p.key;
			opt.textContent = p.name;
			projectSelect.appendChild(opt);
		}
		if (projectKey) {
			projectSelect.value = projectKey;
		}

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
		if (scope === 'project' && projects.length === 0) {
			setStatus('Open a folder/workspace to use Project scope');
			scope = 'global';
			scopeSelect.value = scope;
			return;
		}
		editingId = null;
		editor.value = '';
		lastEditedText = '';
		post({ type: 'setScope', scope });
		post({ type: 'requestDrafts' });
	});

	projectSelect.addEventListener('change', () => {
		if (projects.length === 0) {
			setStatus('Open a folder/workspace to select a project');
			return;
		}
		projectKey = projectSelect.value;
		editingId = null;
		editor.value = '';
		lastEditedText = '';
		post({ type: 'setProject', projectKey });
		post({ type: 'requestDrafts' });
	});

	refreshBtn.addEventListener('click', () => post({ type: 'requestDrafts' }));

	createBtn.addEventListener('click', () => {
		const text = editor.value || '';
		if (!text.trim()) {
			setStatus('Nothing to create');
			return;
		}
		setStatus('Creating…');
		pendingCreate = true;
		post({ type: 'createDraft', text });
		editingId = null;
		editor.value = '';
		lastEditedText = '';
		setTimeout(() => post({ type: 'requestDrafts' }), 50);
		setTimeout(() => {
			if (!pendingCreate) return;
			setStatus('No response from extension. Open Output → Prompt Drafts');
		}, 1500);
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
			pendingCreate = false;
			scope = message.scope;
			projects = message.projects || [];
			projectKey = message.projectKey || null;
			drafts = message.drafts;

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

		if (message.type === 'status') {
			pendingCreate = false;
			setStatus(message.message);
			return;
		}

		if (message.type === 'error') {
			pendingCreate = false;
			setStatus(message.message);
			return;
		}
	});

	setStatus('Ready');
	post({ type: 'ready' });
})();
