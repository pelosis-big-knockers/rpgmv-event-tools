import * as vscode from "vscode";
import { watchDataFiles } from "./data-watcher.js";
import { ExplorerTree } from "./explorer-tree.js";
import { EXPLORER_VIEW, ExplorerProvider, SHOW_EMPTY_ENTRIES_SETTING } from "./explorer-view.js";
import { ProjectSession } from "./project-session.js";
import { ScriptDocuments, pageStartLine } from "./script-documents.js";
import { SCRIPT_SCHEME, parseScriptPath, type ScriptAddress } from "./script-uri.js";

/** Opens a script document, and optionally scrolls to one of its pages. */
export const OPEN_CONTAINER_COMMAND = "rpgmvEventTools.openContainer";

/** What `activate` returns, for the extension's smoke test. */
export interface ExtensionApi {
	readonly explorer: ExplorerProvider;
}

let log: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	log = vscode.window.createOutputChannel("RPG Maker MV", { log: true });
	const session = new ProjectSession(log);
	const documents = new ScriptDocuments(session);
	const explorer = new ExplorerProvider(
		new ExplorerTree(session, { showEmptyEntries: showEmptyEntries() }),
		OPEN_CONTAINER_COMMAND,
	);
	const documentChanged = new vscode.EventEmitter<vscode.Uri>();
	const addFolders = (folders: readonly vscode.WorkspaceFolder[]) => {
		// The tree shows a folder's projects once they've loaded.
		void Promise.all(scanFolders(session, folders)).then(() => explorer.refresh());
	};

	context.subscriptions.push(
		log,
		explorer,
		vscode.window.createTreeView(EXPLORER_VIEW, {
			treeDataProvider: explorer,
			showCollapseAll: true,
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(SHOW_EMPTY_ENTRIES_SETTING)) {
				explorer.tree.options.showEmptyEntries = showEmptyEntries();
				explorer.refresh();
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders((event) => {
			for (const folder of event.removed) {
				session.removeFolder(folder.uri.fsPath);
			}
			addFolders(event.added);
		}),
		documentChanged,
		watchDataFiles({ session, documents, explorer, documentChanged, log }),
		vscode.workspace.registerTextDocumentContentProvider(SCRIPT_SCHEME, {
			onDidChange: documentChanged.event,
			async provideTextDocumentContent(uri) {
				return (await documents.get(addressOf(uri))).text;
			},
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const address = document.uri.scheme === SCRIPT_SCHEME && parseScriptPath(document.uri.path);
			if (address) {
				documents.forget(address);
			}
		}),
		vscode.commands.registerCommand(
			OPEN_CONTAINER_COMMAND,
			(uri: vscode.Uri | string, pageIndex?: number) => openContainer(documents, uri, pageIndex),
		),
	);
	addFolders(vscode.workspace.workspaceFolders ?? []);
	return { explorer };
}

export function deactivate(): void {}

/** Starts loading the projects of local `folders`, each promise resolving when one has loaded. */
function scanFolders(
	session: ProjectSession,
	folders: readonly vscode.WorkspaceFolder[],
): Promise<void>[] {
	return folders.flatMap((folder) => {
		if (folder.uri.scheme !== "file") {
			log.info(`Skipping ${folder.uri.toString()}: only local folders are supported.`);
			return [];
		}
		return [session.addFolder({ name: folder.name, path: folder.uri.fsPath })];
	});
}

function showEmptyEntries(): boolean {
	return vscode.workspace.getConfiguration().get<boolean>(SHOW_EMPTY_ENTRIES_SETTING, false);
}

/**
 * Shows the script document at `target` (a `Uri` or its string form). With `pageIndex`, scrolls
 * to that page and puts the cursor on its first line.
 */
async function openContainer(
	documents: ScriptDocuments,
	target: vscode.Uri | string,
	pageIndex?: number,
): Promise<void> {
	const uri = typeof target === "string" ? vscode.Uri.parse(target, true) : target;
	const address = addressOf(uri);
	const editor = await vscode.window.showTextDocument(uri, { preview: true });
	if (pageIndex === undefined) {
		return;
	}
	const { sourceMap } = await documents.get(address);
	const line = pageStartLine(sourceMap, address.container, pageIndex);
	if (line === undefined) {
		void vscode.window.showWarningMessage(`This script has no page ${pageIndex + 1}.`);
		return;
	}
	const start = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(start, start);
	editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.AtTop);
}

/** The project and container of a script document's URI. Throws if it isn't one. */
function addressOf(uri: vscode.Uri): ScriptAddress {
	const address = uri.scheme === SCRIPT_SCHEME ? parseScriptPath(uri.path) : undefined;
	if (!address) {
		throw new Error(`${uri.toString()} is not an RPG Maker MV script URI.`);
	}
	return address;
}
