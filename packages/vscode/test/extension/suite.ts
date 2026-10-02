import * as assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
	[
		"updates an open script and the tree when a data file changes",
		async () => {
			const uri = "rpgmv:/basic/common-events/1/Toggle lantern.mvscript";
			await vscode.commands.executeCommand(OPEN_CONTAINER, uri);
			const document = activeEditor().document;
			const folder = vscode.workspace.workspaceFolders?.[0];
			assert.ok(folder, "no workspace folder");
			// Written outside VS Code, as the MV editor would. The file watcher may still be
			// starting, so the file is written again until the change is seen.
			const file = join(folder.uri.fsPath, "data", "CommonEvents.json");
			const events = JSON.parse(await readFile(file, "utf8"));
			events[1].name = "Toggle lamp";
			const updated = () => document.getText().includes('name: "Toggle lamp"');
			for (let attempt = 0; attempt < 30 && !updated(); attempt++) {
				await writeFile(file, JSON.stringify(events));
				await waitFor(updated, 1000);
			}
			assert.ok(updated(), document.getText());
			const { explorer } = api;
			const [commonEvents] = await explorer.getChildren();
			const labels = (await explorer.getChildren(commonEvents)).map((node) => node.label);
			assert.ok(labels.includes("1 · Toggle lamp"), labels.join(", "));
		},
	],
];

/** Polls until `done` returns `true` or `ms` milliseconds have passed. */
async function waitFor(done: () => boolean, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (!done() && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

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
