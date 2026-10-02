import * as vscode from "vscode";
import { ExplorerFilter, loadMaps } from "./explorer-filter.js";
import type { ExplorerNode, ExplorerSource } from "./explorer-tree.js";
import { EXPLORER_VIEW, type ExplorerProvider } from "./explorer-view.js";

/** Asks for a filter and applies it to the explorer. */
export const FILTER_EXPLORER_COMMAND = "rpgmvEventTools.filterExplorer";

/** Shows the whole explorer again. */
export const CLEAR_EXPLORER_FILTER_COMMAND = "rpgmvEventTools.clearExplorerFilter";

/** The context key that's set while the explorer is filtered, for menus. */
const FILTERED_CONTEXT = "rpgmvEventTools.explorerFiltered";

/** How often, at most, the tree is rebuilt while maps load for a filter. */
const REFRESH_INTERVAL_MS = 300;

/**
 * Filters the explorer from its title bar. Setting a filter loads the maps that aren't loaded yet,
 * with progress shown in the view, and rebuilds the tree as they load. The view's message shows
 * the filter, or that nothing matches it.
 */
export class ExplorerFilterController implements vscode.Disposable {
	readonly #view: vscode.TreeView<ExplorerNode>;
	readonly #explorer: ExplorerProvider;
	readonly #source: ExplorerSource;
	readonly #disposables: vscode.Disposable[];
	/** Stops the current filter's map loading and updates. */
	#current: AbortController | undefined;

	constructor(
		view: vscode.TreeView<ExplorerNode>,
		explorer: ExplorerProvider,
		source: ExplorerSource,
	) {
		this.#view = view;
		this.#explorer = explorer;
		this.#source = source;
		this.#disposables = [
			vscode.commands.registerCommand(FILTER_EXPLORER_COMMAND, (text?: string) =>
				this.#prompt(text),
			),
			vscode.commands.registerCommand(CLEAR_EXPLORER_FILTER_COMMAND, () => this.apply(undefined)),
		];
	}

	/**
	 * Filters the tree by `text`, or shows all of it with blank text or `undefined`. Resolves when
	 * the filter's maps have loaded and the view shows its results.
	 */
	async apply(text: string | undefined): Promise<void> {
		this.#current?.abort();
		const current = new AbortController();
		this.#current = current;
		const { signal } = current;
		const filter = text === undefined ? undefined : ExplorerFilter.parse(text);
		// Set first: the context key hides the view's welcome, which an empty tree would show.
		await vscode.commands.executeCommand("setContext", FILTERED_CONTEXT, filter !== undefined);
		if (signal.aborted) {
			return;
		}
		this.#explorer.setFilter(filter);
		if (!filter) {
			this.#view.message = "";
			return;
		}
		this.#view.message = `Filtering by "${filter.text}"…`;
		await this.#source.whenLoaded();
		if (signal.aborted) {
			return;
		}
		let lastRefresh = Date.now();
		await vscode.window.withProgress(
			{ location: { viewId: EXPLORER_VIEW }, title: "Loading maps" },
			() =>
				loadMaps(
					this.#source.projects.map((each) => each.project),
					{
						signal,
						onProgress: (done, total) => {
							if (Date.now() - lastRefresh >= REFRESH_INTERVAL_MS) {
								lastRefresh = Date.now();
								this.#explorer.refresh();
								void this.#showResults(filter, signal, `loading maps ${done}/${total}`);
							}
						},
					},
				),
		);
		if (signal.aborted) {
			return;
		}
		this.#explorer.refresh();
		await this.#showResults(filter, signal);
	}

	async #prompt(text?: string): Promise<void> {
		const value =
			text ??
			(await vscode.window.showInputBox({
				title: "Filter Events",
				prompt: "Filter by name, or by id: 12 or #12. Leave it blank to show everything.",
				placeHolder: "Name or id",
				value: this.#explorer.filter?.text ?? "",
			}));
		if (value !== undefined) {
			await this.apply(value);
		}
	}

	/** Shows the filter in the view's message, or that nothing matches it (yet, while `loading`). */
	async #showResults(filter: ExplorerFilter, signal: AbortSignal, loading?: string): Promise<void> {
		const empty = (await this.#explorer.getChildren()).length === 0;
		if (signal.aborted) {
			return;
		}
		const quoted = `"${filter.text}"`;
		this.#view.message = empty
			? loading
				? `Nothing matches ${quoted} yet (${loading}…).`
				: `Nothing matches ${quoted}.`
			: loading
				? `Filtered by ${quoted} (${loading}…).`
				: `Filtered by ${quoted}.`;
	}

	dispose(): void {
		this.#current?.abort();
		for (const disposable of this.#disposables) {
			disposable.dispose();
		}
	}
}
