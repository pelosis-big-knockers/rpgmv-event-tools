import { join } from "node:path";
import {
	asCommonEvents,
	asMap,
	asMapInfos,
	asSystem,
	asTroops,
	commonEventLists,
	mapEventLists,
	mapIdFromFileName,
	troopLists,
	type CommonEvent,
	type LocatedCommandList,
	type MapInfo,
	type MvMap,
	type MvSystem,
	type Troop,
} from "./models.js";
import { readMvFile, writeMvFile } from "./mv-json.js";
import { DATABASE_FILES, createNames, type DatabaseKind, type MvNames } from "./names.js";
import type { MvProjectLocation } from "./project.js";

/** Files every project must have, with the check each one's content must pass. */
const REQUIRED_FILES = {
	"System.json": asSystem,
	"CommonEvents.json": asCommonEvents,
	"MapInfos.json": asMapInfos,
	"Troops.json": asTroops,
} as const;
type RequiredFile = keyof typeof REQUIRED_FILES;

/** Database files that are loaded if present, without checks beyond being valid JSON. */
const OPTIONAL_FILES: readonly string[] = Object.values(DATABASE_FILES).filter(
	(file) => !(file in REQUIRED_FILES),
);

/** The file name MV uses for a map, for example `Map007.json`. */
export function mapFileName(mapId: number): string {
	return `Map${String(mapId).padStart(3, "0")}.json`;
}

/**
 * An MV project's data, loaded from its `data/` folder.
 *
 * `System.json` and the database files are loaded up front. Maps are loaded the first time
 * they're asked for, since a game can have hundreds. Loaded data is kept in memory and can be
 * changed in place, then written back with `save`.
 */
export class MvProject {
	readonly location: MvProjectLocation;
	/** Parsed content by file name, for every file loaded so far. */
	readonly #files = new Map<string, unknown>();
	/** Maps being loaded, so concurrent requests share one read. */
	readonly #loadingMaps = new Map<number, Promise<MvMap>>();
	#names: MvNames | undefined;

	private constructor(location: MvProjectLocation) {
		this.location = location;
	}

	/** Loads a project's `System.json` and database files. Use `loadProject` to call this. */
	static async load(location: MvProjectLocation): Promise<MvProject> {
		const project = new MvProject(location);
		await Promise.all([
			...Object.keys(REQUIRED_FILES).map((file) => project.#loadFile(file)),
			...OPTIONAL_FILES.map((file) => project.#loadFile(file, { optional: true })),
		]);
		return project;
	}

	get system(): MvSystem {
		return this.#required("System.json") as MvSystem;
	}

	get commonEvents(): (CommonEvent | null)[] {
		return this.#required("CommonEvents.json") as (CommonEvent | null)[];
	}

	get mapInfos(): (MapInfo | null)[] {
		return this.#required("MapInfos.json") as (MapInfo | null)[];
	}

	get troops(): (Troop | null)[] {
		return this.#required("Troops.json") as (Troop | null)[];
	}

	/** The parsed content of a database file, or `undefined` if the project doesn't have it. */
	database(kind: DatabaseKind): unknown[] | undefined {
		return this.#files.get(DATABASE_FILES[kind]) as unknown[] | undefined;
	}

	/**
	 * Names of switches, variables and database entries. Rebuilt after `reload`; in-memory edits
	 * to names are not picked up until then.
	 */
	get names(): MvNames {
		this.#names ??= createNames(
			this.system,
			Object.fromEntries(
				(Object.keys(DATABASE_FILES) as DatabaseKind[]).map((kind) => [kind, this.database(kind)]),
			),
		);
		return this.#names;
	}

	/** Ids of the maps listed in `MapInfos.json`, in ascending order. */
	mapIds(): number[] {
		return this.mapInfos.flatMap((info, id) => (info ? [id] : []));
	}

	/** A map's data, loaded from `MapXXX.json` the first time it's asked for. */
	map(mapId: number): Promise<MvMap> {
		const loaded = this.#files.get(mapFileName(mapId));
		if (loaded) {
			return Promise.resolve(loaded as MvMap);
		}
		let loading = this.#loadingMaps.get(mapId);
		if (!loading) {
			loading = this.#loadFile(mapFileName(mapId)).finally(() => {
				this.#loadingMaps.delete(mapId);
			}) as Promise<MvMap>;
			this.#loadingMaps.set(mapId, loading);
		}
		return loading;
	}

	isMapLoaded(mapId: number): boolean {
		return this.#files.has(mapFileName(mapId));
	}

	/** File names of everything currently loaded, including maps loaded so far. */
	loadedFiles(): string[] {
		return [...this.#files.keys()].sort();
	}

	/**
	 * Every command list in the project: common events, then troop pages, then map event pages
	 * by map id. Maps are loaded as they're reached.
	 */
	async *commandLists(): AsyncGenerator<LocatedCommandList> {
		yield* commonEventLists(this.commonEvents);
		yield* troopLists(this.troops);
		for (const mapId of this.mapIds()) {
			yield* mapEventLists(mapId, await this.map(mapId));
		}
	}

	/**
	 * Reads a file from disk again, replacing what's in memory, for example after it changed
	 * outside this project. A map that isn't loaded yet is left to load when first asked for.
	 */
	async reload(fileName: string): Promise<void> {
		const mapId = mapIdFromFileName(fileName);
		if (mapId !== undefined) {
			this.#loadingMaps.delete(mapId);
			if (this.#files.has(fileName)) {
				await this.#loadFile(fileName);
			}
			return;
		}
		if (fileName in REQUIRED_FILES) {
			await this.#loadFile(fileName);
		} else if (OPTIONAL_FILES.includes(fileName)) {
			this.#files.delete(fileName);
			await this.#loadFile(fileName, { optional: true });
		} else {
			throw new Error(`${fileName} is not a data file this project loads`);
		}
		this.#names = undefined;
	}

	/** Writes a loaded file back to disk in the MV editor's layout. */
	async save(fileName: string): Promise<void> {
		if (!this.#files.has(fileName)) {
			throw new Error(`${fileName} is not loaded, so there is nothing to save`);
		}
		await writeMvFile(join(this.location.dataDir, fileName), this.#files.get(fileName));
	}

	#required(file: RequiredFile): unknown {
		return this.#files.get(file);
	}

	/** Reads, checks and stores one file. Errors name the file. */
	async #loadFile(fileName: string, options: { optional?: boolean } = {}): Promise<unknown> {
		let content: unknown;
		try {
			content = await readMvFile(join(this.location.dataDir, fileName));
		} catch (error) {
			if (options.optional && isMissingFile(error)) {
				return undefined;
			}
			throw new Error(
				`Could not load ${fileName} from ${this.location.dataDir}: ${message(error)}`,
				{
					cause: error,
				},
			);
		}
		const check: ((value: unknown, file: string) => unknown) | undefined =
			fileName in REQUIRED_FILES
				? REQUIRED_FILES[fileName as RequiredFile]
				: mapIdFromFileName(fileName) !== undefined
					? asMap
					: undefined;
		check?.(content, fileName);
		this.#files.set(fileName, content);
		return content;
	}
}

/** Loads a project's `System.json` and database files. Maps load when first asked for. */
export function loadProject(location: MvProjectLocation): Promise<MvProject> {
	return MvProject.load(location);
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
