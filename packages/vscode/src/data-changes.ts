import { basename, dirname, relative } from "node:path";
import { isProjectDataFile, mapFileName, mapIdFromFileName } from "@rpgmv-event-tools/core";
import type { ExplorerNode } from "./explorer-tree.js";
import type { SessionProject } from "./project-session.js";
import type { ScriptAddress } from "./script-uri.js";

/**
 * Keeps the session's projects up to date when their data files change on disk, for example
 * when the MV editor saves, and decides what the change affects. This module doesn't use the
 * VS Code API, so it can be tested on its own; the extension feeds it the paths a file watcher
 * reports and refreshes what it says to.
 */

/** How long to wait after the last change before handling a batch, in milliseconds. */
export const CHANGE_DELAY_MS = 300;

/**
 * Collects changed paths and hands them over together once none has come for a short time,
 * since the MV editor rewrites many files on one save. Batches are handled one at a time, in
 * the order they were handed over.
 */
export class ChangeBatcher {
	readonly #handle: (paths: string[]) => Promise<void> | void;
	readonly #delayMs: number;
	readonly #onError: (error: unknown) => void;
	readonly #pending = new Set<string>();
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Settles when the last batch handed over has been handled. */
	#handling: Promise<void> = Promise.resolve();

	constructor(
		handle: (paths: string[]) => Promise<void> | void,
		options: { delayMs?: number; onError?: (error: unknown) => void } = {},
	) {
		this.#handle = handle;
		this.#delayMs = options.delayMs ?? CHANGE_DELAY_MS;
		this.#onError = options.onError ?? (() => {});
	}

	/** Adds a changed path, and restarts the wait. */
	add(path: string): void {
		this.#pending.add(path);
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.flush(), this.#delayMs);
	}

	/** Hands over the paths collected so far without waiting. Resolves once they're handled. */
	flush(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		if (this.#pending.size > 0) {
			const paths = [...this.#pending];
			this.#pending.clear();
			// A failed batch is reported, and doesn't stop the ones after it.
			this.#handling = this.#handling.then(() => this.#handle(paths)).catch(this.#onError);
		}
		return this.#handling;
	}

	/** Drops the paths not handed over yet. */
	dispose(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#pending.clear();
	}
}

/** What changed in one project after its files were reloaded. */
export interface DataChange {
	readonly project: SessionProject;
	/**
	 * Whether `System.json` or a database file changed. They hold the names the script uses, so
	 * every document and page description of the project may change.
	 */
	readonly names: boolean;
	/** The maps whose files changed. */
	readonly mapIds: ReadonlySet<number>;
}

/** Where reloading reports what it did and what failed. */
export interface ChangeLog {
	info(message: string): void;
	warn(message: string, error: unknown): void;
}

/**
 * Reloads the changed files at `paths` into the projects whose data folders hold them, and
 * returns what changed in each project. Paths outside the projects' data folders, and files
 * projects don't load, are ignored. A file that fails to load, often because a save is still in
 * progress, keeps its last good data and is logged; it's tried again when it next changes.
 */
export async function reloadChangedFiles(
	projects: readonly SessionProject[],
	paths: Iterable<string>,
	log: ChangeLog,
): Promise<DataChange[]> {
	const files = new Map<SessionProject, Set<string>>();
	for (const path of paths) {
		const project = projects.find(
			(each) => relative(each.project.location.dataDir, dirname(path)) === "",
		);
		const fileName = project && dataFileName(basename(path));
		if (project && fileName) {
			let names = files.get(project);
			if (!names) {
				names = new Set();
				files.set(project, names);
			}
			names.add(fileName);
		}
	}
	const changes = await Promise.all(
		[...files].map(([project, fileNames]) => reloadFiles(project, [...fileNames].sort(), log)),
	);
	return changes.filter((change) => change.names || change.mapIds.size > 0);
}

async function reloadFiles(
	project: SessionProject,
	fileNames: readonly string[],
	log: ChangeLog,
): Promise<DataChange> {
	const reloaded = await Promise.all(
		fileNames.map(async (fileName) => {
			try {
				await project.project.reload(fileName);
				return [fileName];
			} catch (error) {
				log.warn(
					`Could not reload ${fileName} of rpgmv:/${project.key}; keeping its last good data until it changes again:`,
					error,
				);
				return [];
			}
		}),
	);
	const changed = reloaded.flat();
	if (changed.length > 0) {
		log.info(`Reloaded ${changed.join(", ")} of rpgmv:/${project.key}.`);
	}
	const mapIds = new Set<number>();
	let names = false;
	for (const fileName of changed) {
		const mapId = mapIdFromFileName(fileName);
		if (mapId === undefined) {
			names = true;
		} else {
			mapIds.add(mapId);
		}
	}
	return { project, names, mapIds };
}

/** The name a project knows a changed file by, or `undefined` if it doesn't load the file. */
function dataFileName(fileName: string): string | undefined {
	const mapId = mapIdFromFileName(fileName);
	if (mapId !== undefined) {
		return mapFileName(mapId);
	}
	return isProjectDataFile(fileName) ? fileName : undefined;
}

/** Whether the document at `address` may show different text after `change`. */
export function affectsDocument(change: DataChange, address: ScriptAddress): boolean {
	if (address.projectKey !== change.project.key) {
		return false;
	}
	return (
		change.names ||
		(address.container.kind === "mapEvent" && change.mapIds.has(address.container.mapId))
	);
}

/**
 * The nodes of the explorer's tree to build again after `change`, out of the nodes it has
 * `shown`, with `undefined` for the whole tree. A change to names rebuilds the project (the whole
 * tree when the project's categories are the top level); a change to a map rebuilds the map's
 * node, which lists its events.
 */
export function nodesToRefresh(
	change: DataChange,
	shown: Iterable<ExplorerNode>,
): (ExplorerNode | undefined)[] {
	const key = change.project.key;
	const nodes = [...shown];
	if (change.names) {
		const project = nodes.find((node) => node.kind === "project" && node.project.key === key);
		return [project];
	}
	return nodes.filter(
		(node) => node.kind === "map" && node.project.key === key && change.mapIds.has(node.mapId),
	);
}
