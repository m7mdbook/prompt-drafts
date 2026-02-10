import * as vscode from 'vscode';

import { DraftsStore, DraftScope } from './draftsStore';
import { PromptManagerViewProvider } from './promptManagerView';

const SCOPE_KEY = 'promptDrafts.scope';
const INPUT_BUFFER_KEY = 'promptDrafts.inputBuffer';

function getCurrentScope(context: vscode.ExtensionContext): DraftScope {
  return context.globalState.get<DraftScope>(SCOPE_KEY) ?? 'global';
}

export function activate(context: vscode.ExtensionContext) {
  const store = new DraftsStore(context);

  const promptManagerProvider = new PromptManagerViewProvider(context, store);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PromptManagerViewProvider.viewType, promptManagerProvider)
  );

  const saveCmd = vscode.commands.registerCommand(
    'promptDrafts.save',
    async () => {
      const scope = getCurrentScope(context);
      const input = vscode.window.createInputBox();
      input.title = 'Save Prompt Draft';
      input.prompt = 'Paste or type the prompt to save';
      input.ignoreFocusOut = true;
      input.value = context.globalState.get<string>(INPUT_BUFFER_KEY) ?? '';

      let lastBufferedValue = input.value;
      const autosaveTimer = setInterval(() => {
        if (input.value === lastBufferedValue) {
				return;
			}
        lastBufferedValue = input.value;
        void context.globalState.update(INPUT_BUFFER_KEY, lastBufferedValue);
      }, 2000);

      const cleanup = () => {
        clearInterval(autosaveTimer);
        input.dispose();
      };

      input.onDidHide(cleanup);
      input.onDidAccept(async () => {
        const text = input.value;
        if (!text.trim()) {
          cleanup();
          return;
        }
        await store.addDraft(scope, text);
        await context.globalState.update(INPUT_BUFFER_KEY, '');
        cleanup();
        vscode.window.showInformationMessage('Prompt draft saved');
      });

      input.show();
    }
  );

  context.subscriptions.push(saveCmd);


  const insertCmd = vscode.commands.registerCommand(
  'promptDrafts.insert',
  async () => {
    const scope = getCurrentScope(context);
    const drafts = store.getDrafts(scope);

    if (!drafts.length) {
      vscode.window.showWarningMessage('No saved prompt drafts');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      drafts.map(d => ({
        label: d.text.slice(0, 60) || '(empty)',
        description: d.text.length > 60 ? '...' : '',
        value: d.text
      }))
    );

    if (!pick) {
		return;
	}

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open an editor first');
      return;
    }

    editor.insertSnippet(new vscode.SnippetString(pick.value));
  }
);

context.subscriptions.push(insertCmd);

}

export function deactivate() {}



