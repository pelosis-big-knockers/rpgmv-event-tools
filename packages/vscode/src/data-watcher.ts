import * as vscode from "vscode";
import {
	ChangeBatcher,
	affectsDocument,
	nodesToRefresh,
	reloadChangedFiles,
} from "./data-changes.js";
import type { ExplorerProvider } from "./explorer-view.js";
import type { ProjectSession } from "./project-session.js";
import type { ScriptDocuments } from "./script-documents.js";
import { SCRIPT_SCHEME, parseScriptPath } from "./script-uri.js";

/** What the watcher keeps up to date. */
export interface WatchedViews {
	readonly session: ProjectSession;
	readonly documents: ScriptDocuments;
	readonly explorer: ExplorerProvider;
	/** Tells VS Code an open script document's text changed. */
	readonly documentChanged: vscode.EventEmitter<vscode.Uri>;
	readonly log: vscode.LogOutputChannel;
}

/**
 * Watches the data files of the workspace's projects, reloads them in batches as they change
 * (see `data-changes.ts`), and refreshes the explorer's nodes and the open script documents
 * that show them.
 */
export function watchDataFiles(views: WatchedViews): vscode.Disposable {
	const { session, documents, explorer, documentChanged, log } = views;
	const batcher = new ChangeBatcher(
		async (paths) => {
			await session.whenLoaded();
			const changes = await reloadChangedFiles(session.projects, paths, log);
			const refreshes = new Set(
				changes.flatMap((change) => nodesToRefresh(change, explorer.shownNodes)),
			);
			if (refreshes.has(undefined)) {
				explorer.refresh();
			} else {
				for (const node of refreshes) {
					explorer.refresh(node);
				}
			}
			for (const change of changes) {
				documents.forgetWhere((address) => affectsDocument(change, address));
			}
			for (const document of vscode.workspace.textDocuments) {
				const address =
					document.uri.scheme === SCRIPT_SCHEME ? parseScriptPath(document.uri.path) : undefined;
				if (address && changes.some((change) => affectsDocument(change, address))) {
					documentChanged.fire(document.uri);
				}
			}
		},
		{ onError: (error) => log.error("Failed to handle changed data files:", error) },
	);
	// Matches `data/` and `www/data/` of every project in the workspace's folders.
	const watcher = vscode.workspace.createFileSystemWatcher("**/data/*.json");
	const changed = (uri: vscode.Uri) => {
		if (uri.scheme === "file") {
			batcher.add(uri.fsPath);
		}
	};
	return vscode.Disposable.from(
		watcher,
		watcher.onDidCreate(changed),
		watcher.onDidChange(changed),
		watcher.onDidDelete(changed),
		{ dispose: () => batcher.dispose() },
	);
}
