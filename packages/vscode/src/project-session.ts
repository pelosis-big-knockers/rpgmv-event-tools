import { relative, sep } from "node:path";
import {
	findProjects,
	loadProject,
	summarizeProject,
	type MvProject,
	type MvProjectLocation,
} from "@rpgmv-event-tools/core";

/**
 * The MV projects in the workspace. This module doesn't use the VS Code API, so it can be
 * tested on its own; the extension feeds it workspace folders as they come and go.
 */

/** A local workspace folder. */
export interface SessionFolder {
	readonly name: string;
	/** The folder's path on disk. */
	readonly path: string;
}

/** A loaded project and where it was found. */
export interface SessionProject {
	/**
	 * Names the project in `rpgmv:` URIs: the workspace folder's name, then the game folder's
	 * path relative to it, joined with `/`. Unique among the session's projects.
	 */
	readonly key: string;
	readonly folder: SessionFolder;
	readonly project: MvProject;
}

/** Where the session reports what it found and what failed. */
export interface SessionLog {
	info(message: string): void;
	error(message: string, error: unknown): void;
}

/** How the session finds and loads projects. Tests replace these. */
export interface SessionLoader {
	findProjects(folder: string): Promise<MvProjectLocation[]>;
	loadProject(location: MvProjectLocation): Promise<MvProject>;
}

const DEFAULT_LOADER: SessionLoader = { findProjects, loadProject };

/**
 * Finds and loads the MV projects in each workspace folder added to it. A folder can hold several
 * projects. Projects that fail to load are logged and left out.
 */
export class ProjectSession {
	readonly #log: SessionLog;
	readonly #loader: SessionLoader;
	/** Loaded projects by key. */
	readonly #projects = new Map<string, SessionProject>();
	/** Folders added and not removed, by path, each with its scan (in progress or done). */
	readonly #folders = new Map<string, { scan: Promise<void> }>();

	constructor(log: SessionLog, loader: SessionLoader = DEFAULT_LOADER) {
		this.#log = log;
		this.#loader = loader;
	}

	/** The loaded projects, by key. */
	get projects(): SessionProject[] {
		return [...this.#projects.values()].sort((a, b) => a.key.localeCompare(b.key));
	}

	/** Finds and loads the projects in `folder`. Resolves when they're loaded. */
	addFolder(folder: SessionFolder): Promise<void> {
		this.removeFolder(folder.path);
		const entry = { scan: Promise.resolve() };
		this.#folders.set(folder.path, entry);
		entry.scan = this.#scan(folder, entry);
		return entry.scan;
	}

	/** Forgets the projects of the folder at `path`, including ones still loading. */
	removeFolder(path: string): void {
		this.#folders.delete(path);
		for (const [key, project] of this.#projects) {
			if (project.folder.path === path) {
				this.#projects.delete(key);
			}
		}
	}

	/** The project with `key`, once every folder added so far has been scanned. */
	async project(key: string): Promise<SessionProject | undefined> {
		await this.whenLoaded();
		return this.#projects.get(key);
	}

	/** Resolves when every folder added so far has been scanned. */
	async whenLoaded(): Promise<void> {
		await Promise.all([...this.#folders.values()].map((entry) => entry.scan));
	}

	async #scan(folder: SessionFolder, entry: { scan: Promise<void> }): Promise<void> {
		let locations: MvProjectLocation[];
		try {
			locations = await this.#loader.findProjects(folder.path);
		} catch (error) {
			this.#log.error(`Failed to search ${folder.path} for projects:`, error);
			return;
		}
		if (locations.length === 0) {
			this.#log.info(`No RPG Maker MV project found in ${folder.path}.`);
		}
		const loaded = await Promise.all(
			locations.map(async (location) => {
				try {
					return await this.#loader.loadProject(location);
				} catch (error) {
					this.#log.error(`Could not read the project's data files in ${location.dataDir}:`, error);
					return undefined;
				}
			}),
		);
		// The folder may have been removed, or added again, while its projects loaded.
		if (this.#folders.get(folder.path) !== entry) {
			return;
		}
		for (const project of loaded) {
			if (project) {
				this.#add(folder, project);
			}
		}
	}

	#add(folder: SessionFolder, project: MvProject): void {
		const base = projectKey(folder, project.location.gameDir);
		let key = base;
		for (let n = 2; this.#projects.has(key); n++) {
			key = `${base} (${n})`;
		}
		this.#projects.set(key, { key, folder, project });
		const summary = summarizeProject(project);
		const counts = [
			count(summary.commonEvents, "common event"),
			count(summary.maps, "map"),
			count(summary.switches, "switch", "switches"),
			count(summary.variables, "variable"),
		];
		this.#log.info(
			`Loaded "${summary.title}" (${project.location.layout} layout) from ` +
				`${project.location.gameDir} as rpgmv:/${key}: ${counts.join(", ")}`,
		);
	}
}

/**
 * A project's key before making it unique: the folder's name and the game folder's path in it,
 * with each segment's `/` and `\` replaced so the key splits into the same segments.
 */
export function projectKey(folder: SessionFolder, gameDir: string): string {
	const inFolder = relative(folder.path, gameDir);
	const segments = [folder.name, ...(inFolder ? inFolder.split(sep) : [])];
	return segments.map((segment) => segment.replace(/[/\\]/g, "_").trim() || "_").join("/");
}

function count(n: number, singular: string, plural = `${singular}s`): string {
	return `${n} ${n === 1 ? singular : plural}`;
}
