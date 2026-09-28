import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/**
 * How an RPG Maker MV game is laid out on disk.
 *
 * - `editor`: an editor project folder, containing `Game.rpgproject` and `data/`.
 * - `www`: a deployed desktop (NW.js) game, with the game files under `www/`.
 * - `flat`: `data/` directly under the game folder with no project file, as in a web deployment.
 */
export type MvLayout = "editor" | "www" | "flat";

export interface MvProjectLocation {
	/** Folder holding `data/`, `js/`, `img/` and so on. For a `www` layout this is the `www/` folder. */
	gameDir: string;
	/** The `data/` folder holding `System.json`, `CommonEvents.json`, `MapXXX.json` and the rest. */
	dataDir: string;
	layout: MvLayout;
}

/**
 * Resolves the MV project at `path`, which may be the game's root folder, its `www/` folder,
 * an editor project folder, or the `data/` folder itself.
 *
 * Returns `undefined` when no `System.json` is found in any of those places.
 */
export async function resolveMvProject(path: string): Promise<MvProjectLocation | undefined> {
	const start = resolve(path);
	const candidates = [
		start,
		join(start, "www"),
		// `path` may already be the data folder.
		...(basename(start).toLowerCase() === "data" ? [dirname(start)] : []),
	];

	for (const gameDir of candidates) {
		const dataDir = join(gameDir, "data");
		if (await isFile(join(dataDir, "System.json"))) {
			return { gameDir, dataDir, layout: await detectLayout(gameDir) };
		}
	}
	return undefined;
}

export interface FindProjectsOptions {
	/** How many folder levels below `folder` to search. Defaults to 4. */
	maxDepth?: number;
}

/** Folders that never contain a game worth finding, and can be very large. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);

/**
 * Finds the MV projects in `folder` or below it, for example every game in a workspace.
 * Searching stops at each project found, so folders inside a game are not searched.
 * Results are sorted by `dataDir`.
 */
export async function findProjects(
	folder: string,
	options: FindProjectsOptions = {},
): Promise<MvProjectLocation[]> {
	const maxDepth = options.maxDepth ?? 4;
	const found = new Map<string, MvProjectLocation>();

	async function visit(dir: string, depth: number): Promise<void> {
		const project = await resolveMvProject(dir);
		if (project) {
			found.set(project.dataDir, project);
			return;
		}
		if (depth >= maxDepth) {
			return;
		}
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return; // Unreadable folders are skipped, not fatal.
		}
		await Promise.all(
			entries
				.filter((entry) => entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name))
				.map((entry) => visit(join(dir, entry.name), depth + 1)),
		);
	}

	await visit(resolve(folder), 0);
	return [...found.values()].sort((a, b) => a.dataDir.localeCompare(b.dataDir));
}

async function detectLayout(gameDir: string): Promise<MvLayout> {
	if (await isFile(join(gameDir, "Game.rpgproject"))) {
		return "editor";
	}
	return basename(gameDir).toLowerCase() === "www" ? "www" : "flat";
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
