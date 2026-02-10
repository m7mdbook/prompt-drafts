import * as vscode from 'vscode';

export type DraftScope = 'project' | 'global';

export type PromptDraft = {
	id: string;
	text: string;
	createdAt: number;
	updatedAt: number;
};

const DRAFTS_KEY = 'drafts';

function nowMs(): number {
	return Date.now();
}

function createId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDrafts(value: unknown): PromptDraft[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const drafts: PromptDraft[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const anyItem = item as Partial<PromptDraft>;
		if (typeof anyItem.text !== 'string') {
			continue;
		}

		drafts.push({
			id: typeof anyItem.id === 'string' ? anyItem.id : createId(),
			text: anyItem.text,
			createdAt: typeof anyItem.createdAt === 'number' ? anyItem.createdAt : nowMs(),
			updatedAt: typeof anyItem.updatedAt === 'number' ? anyItem.updatedAt : nowMs(),
		});
	}

	// newest first
	drafts.sort((a, b) => b.updatedAt - a.updatedAt);
	return drafts;
}

export class DraftsStore {
	public constructor(private readonly context: vscode.ExtensionContext) {}

	private memento(scope: DraftScope): vscode.Memento {
		return scope === 'project' ? this.context.workspaceState : this.context.globalState;
	}

	public getDrafts(scope: DraftScope): PromptDraft[] {
		return normalizeDrafts(this.memento(scope).get(DRAFTS_KEY));
	}

	public async addDraft(scope: DraftScope, text: string): Promise<PromptDraft> {
		const drafts = this.getDrafts(scope);
		const time = nowMs();
		const draft: PromptDraft = {
			id: createId(),
			text,
			createdAt: time,
			updatedAt: time,
		};
		await this.memento(scope).update(DRAFTS_KEY, [draft, ...drafts]);
		return draft;
	}

	public async updateDraft(scope: DraftScope, id: string, text: string): Promise<void> {
		const drafts = this.getDrafts(scope);
		const time = nowMs();
		const updated = drafts.map((d) => (d.id === id ? { ...d, text, updatedAt: time } : d));
		await this.memento(scope).update(DRAFTS_KEY, updated);
	}

	public async deleteDraft(scope: DraftScope, id: string): Promise<void> {
		const drafts = this.getDrafts(scope);
		await this.memento(scope).update(
			DRAFTS_KEY,
			drafts.filter((d) => d.id !== id)
		);
	}
}
