import * as assert from "node:assert/strict";
import * as vscode from "vscode";

/**
 * The extension smoke test, run inside VS Code by `run.mjs` with the basic fixture open as the
 * workspace. VS Code calls `run`; a rejection fails the test.
 */

const EXTENSION_ID = "p-b-k.rpgmv-event-tools";
const OPEN_CONTAINER = "rpgmvEventTools.openContainer";

const tests: [string, () => Promise<void>][] = [
	[
		"opens a common event's script",
		async () => {
			await vscode.commands.executeCommand(
				OPEN_CONTAINER,
				"rpgmv:/basic/common-events/1/Toggle lantern.mvscript",
			);
			const document = activeEditor().document;
			assert.equal(document.uri.scheme, "rpgmv");
			const text = document.getText();
			assert.ok(text.startsWith('/// <reference types="rpgmv-event-tools" />\n'), text);
			assert.match(text, /defineCommonEvent\(\s*\{ id: 1, name: "Toggle lantern"/);
			assert.match(text, /"You put out the lantern\."/);
		},
	],
	[
		"scrolls to a map event's page",
		async () => {
			const uri = vscode.Uri.from({
				scheme: "rpgmv",
				path: "/basic/maps/1/events/1/Keeper.mvscript",
			});
			await vscode.commands.executeCommand(OPEN_CONTAINER, uri, 1);
			const editor = activeEditor();
			const lines = editor.document.getText().split("\n");
			assert.match(lines[2] ?? "", /^defineMapEvent\(\{ id: 1, name: "Keeper"/);
			const pageLines = lines.flatMap((text, index) => (text.startsWith("\tpage(") ? [index] : []));
			assert.equal(pageLines.length, 2);
			assert.equal(editor.selection.active.line, pageLines[1]);
		},
	],
];

export async function run(): Promise<void> {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	assert.ok(extension, `${EXTENSION_ID} is not installed`);
	await extension.activate();
	let failed = 0;
	for (const [name, test] of tests) {
		try {
			await test();
			console.log(`  ok  ${name}`);
		} catch (error) {
			failed++;
			console.error(`  FAIL  ${name}\n`, error);
		}
	}
	if (failed > 0) {
		throw new Error(`${failed} of ${tests.length} smoke tests failed`);
	}
}

function activeEditor(): vscode.TextEditor {
	const editor = vscode.window.activeTextEditor;
	assert.ok(editor, "no active editor");
	return editor;
}
