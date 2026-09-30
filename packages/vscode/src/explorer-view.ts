import * as vscode from "vscode";
import type { ExplorerCategory, ExplorerNode, ExplorerTree } from "./explorer-tree.js";
import { SCRIPT_SCHEME } from "./script-uri.js";

/** The explorer's view, in the "RPG Maker MV" view container. */
export const EXPLORER_VIEW = "rpgmvEventTools.explorer";

/** The setting that shows the empty slots of common events and troops. */
export const SHOW_EMPTY_ENTRIES_SETTING = "rpgmvEventTools.showEmptyEntries";

const CATEGORY_ICONS: Record<ExplorerCategory, string> = {
	commonEvents: "symbol-event",
	maps: "map",
	troops: "organization",
};

/**
 * Shows an {@link ExplorerTree} in a tree view. Clicking a container opens its script document,
 * and clicking a page opens the document at that page, with `openCommand`.
 */
export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable {
	readonly tree: ExplorerTree;
	readonly #openCommand: string;
	readonly #onDidChangeTreeData = new vscode.EventEmitter<ExplorerNode | undefined>();
	readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;

	constructor(tree: ExplorerTree, openCommand: string) {
		this.tree = tree;
		this.#openCommand = openCommand;
	}

	/** Builds `node`'s children again, or the whole tree without it. */
	refresh(node?: ExplorerNode): void {
		this.#onDidChangeTreeData.fire(node);
	}

	getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
		return this.tree.children(node);
	}

	getParent(node: ExplorerNode): ExplorerNode | undefined {
		return node.parent;
	}

	getTreeItem(node: ExplorerNode): vscode.TreeItem {
		const item = new vscode.TreeItem(
			node.label,
			node.collapsible
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
		);
		item.id = node.id;
		item.contextValue = node.kind;
		item.iconPath = new vscode.ThemeIcon(icon(node));
		if (node.description !== undefined) {
			item.description = node.description;
		}
		if (node.tooltip) {
			const tooltip = new vscode.MarkdownString().appendText(node.tooltip.text);
			if (node.tooltip.code !== undefined) {
				tooltip.appendCodeblock(node.tooltip.code, "rpgmv-script");
			}
			item.tooltip = tooltip;
		}
		if (node.open) {
			const uri = vscode.Uri.from({ scheme: SCRIPT_SCHEME, path: node.open.path });
			item.command = {
				command: this.#openCommand,
				title: "Open Event Script",
				arguments: node.open.pageIndex === undefined ? [uri] : [uri, node.open.pageIndex],
			};
		}
		return item;
	}

	dispose(): void {
		this.#onDidChangeTreeData.dispose();
	}
}

function icon(node: ExplorerNode): string {
	switch (node.kind) {
		case "project":
			return "game";
		case "category":
			return CATEGORY_ICONS[node.category];
		case "map":
			return "map";
		case "container":
			return node.container.kind === "troop" ? "organization" : "symbol-event";
		case "page":
			return "file";
		case "message":
			return "warning";
	}
}
