import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionApi } from "../../src/extension.js";

/**
 * The extension smoke test, run inside VS Code by `run.mjs` with the basic fixture open as the
 * workspace. VS Code calls `run`; a rejection fails the test.
 */

const EXTENSION_ID = "p-b-k.rpgmv-event-tools";
const OPEN_CONTAINER = "rpgmvEventTools.openContainer";

let api: ExtensionApi;

const tests: [string, () => Promise<void>][] = [
	[
		"shows the fixture's categories in the explorer",
		async () => {
			const { explorer } = api;
			const categories = await explorer.getChildren();
			assert.deepEqual(
				categories.map((node) => explorer.getTreeItem(node).label),
				["Common Events", "Maps", "Troops"],
			);
			const troops = await explorer.getChildren(categories[2]);
			const pages = await explorer.getChildren(troops[0]);
			const page = explorer.getTreeItem(pages[1]!);
			assert.equal(page.label, "Page 2");
			assert.equal(page.command?.command, OPEN_CONTAINER);
			const [uri, pageIndex] = page.command?.arguments ?? [];
			assert.equal(String(uri), "rpgmv:/basic/troops/1/Cellar%20Bats.mvscript");
			assert.equal(pageIndex, 1);
		},
	],
	[
		"filters the explorer",
		async () => {
			const { explorer, filter } = api;
			await filter.apply("lantern");
			const categories = await explorer.getChildren();
			const item = explorer.getTreeItem(categories[0]!);
			assert.deepEqual([item.label, item.description], ["Common Events", "1"]);
			assert.equal(categories.length, 1);
			assert.equal(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
			const events = await explorer.getChildren(categories[0]);
			assert.deepEqual(
				events.map((node) => node.label),
				["1 · Toggle lantern"],
			);

			await vscode.commands.executeCommand("rpgmvEventTools.filterExplorer", "dragon");
			assert.deepEqual(await explorer.getChildren(), []);
			await vscode.commands.executeCommand("rpgmvEventTools.clearExplorerFilter");
			const all = await explorer.getChildren();
			assert.equal(all.length, 3);
			assert.equal(
				explorer.getTreeItem(all[0]!).collapsibleState,
				vscode.TreeItemCollapsibleState.Collapsed,
			);
		},
	],
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
	api = (await extension.activate()) as ExtensionApi;
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
