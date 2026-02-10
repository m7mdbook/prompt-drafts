import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Registers contributed commands', async () => {
		const extension = vscode.extensions.getExtension('m7mdbook.prompt-drafts');
		assert.ok(extension, 'Extension not found (expected id: m7mdbook.prompt-drafts)');

		await extension!.activate();

		const commands = await vscode.commands.getCommands(true);
		const expected = [
			'promptDrafts.save',
			'promptDrafts.insert',
			'promptDrafts.openManager',
		];

		for (const command of expected) {
			assert.ok(
				commands.includes(command),
				`Missing command registration: ${command}`
			);
		}
	});
});
