import { stat } from "node:fs/promises";
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
