import { join } from "node:path";
import { readMvFile } from "./mv-json.js";

/** Database files whose entries have an `id` and a `name`, by the kind of thing they hold. */
export const DATABASE_FILES = {
	actor: "Actors.json",
	class: "Classes.json",
	skill: "Skills.json",
	item: "Items.json",
	weapon: "Weapons.json",
	armor: "Armors.json",
	enemy: "Enemies.json",
	troop: "Troops.json",
	state: "States.json",
	animation: "Animations.json",
	tileset: "Tilesets.json",
	commonEvent: "CommonEvents.json",
	map: "MapInfos.json",
} as const;

/** Name lists in `System.json`, by the kind of thing they name. Index 0 is always unused. */
export const SYSTEM_NAME_LISTS = {
	switch: "switches",
	variable: "variables",
	element: "elements",
	skillType: "skillTypes",
	weaponType: "weaponTypes",
	armorType: "armorTypes",
	equipType: "equipTypes",
} as const;

export type DatabaseKind = keyof typeof DATABASE_FILES;
export type SystemNameKind = keyof typeof SYSTEM_NAME_LISTS;
/** Everything a command can refer to by id. */
export type NamedKind = DatabaseKind | SystemNameKind;

/**
 * Names of switches, variables and database entries by id, for readable output such as
 * `S[3:"Lantern lit"]`.
 */
export class MvNames {
	readonly #tables: ReadonlyMap<NamedKind, readonly (string | undefined)[]>;

	/** Use `createNames` or `loadNames` rather than calling this directly. */
	constructor(tables: ReadonlyMap<NamedKind, readonly (string | undefined)[]>) {
		this.#tables = tables;
	}

	/**
	 * The name of entry `id`, or `undefined` if the id is out of range, the entry is unused or
	 * deleted, or its name is empty. Never throws.
	 */
	of(kind: NamedKind, id: number): string | undefined {
		return Number.isInteger(id) && id > 0 ? this.#tables.get(kind)?.[id] : undefined;
	}

	switch(id: number): string | undefined {
		return this.of("switch", id);
	}

	variable(id: number): string | undefined {
		return this.of("variable", id);
	}

	commonEvent(id: number): string | undefined {
		return this.of("commonEvent", id);
	}

	/** The highest id of `kind` (the number of slots, named or not). */
	count(kind: NamedKind): number {
		return Math.max(0, (this.#tables.get(kind)?.length ?? 0) - 1);
	}
}

/**
 * Builds name lookups from parsed data: `System.json`, and whichever database files are given
 * (their parsed arrays, by kind). Missing files give empty tables.
 */
export function createNames(
	system: unknown,
	databases: Partial<Record<DatabaseKind, unknown>> = {},
): MvNames {
	const tables = new Map<NamedKind, (string | undefined)[]>();
	const systemRecord = isRecord(system) ? system : {};
	for (const [kind, key] of Object.entries(SYSTEM_NAME_LISTS) as [SystemNameKind, string][]) {
		const list = systemRecord[key];
		tables.set(kind, Array.isArray(list) ? list.map((name) => nameOrUndefined(name)) : []);
	}
	for (const kind of Object.keys(DATABASE_FILES) as DatabaseKind[]) {
		const entries = databases[kind];
		tables.set(
			kind,
			Array.isArray(entries)
				? entries.map((entry) => (isRecord(entry) ? nameOrUndefined(entry["name"]) : undefined))
				: [],
		);
	}
	return new MvNames(tables);
}

/**
 * Reads `System.json` and the database files in `dataDir` and builds name lookups.
 * `System.json` is required; a missing database file gives an empty table for its kind.
 */
export async function loadNames(dataDir: string): Promise<MvNames> {
	const system = await readMvFile(join(dataDir, "System.json"));
	const entries = await Promise.all(
		(Object.entries(DATABASE_FILES) as [DatabaseKind, string][]).map(
			async ([kind, file]) =>
				[kind, await readMvFile(join(dataDir, file)).catch(ignoreMissing)] as const,
		),
	);
	return createNames(system, Object.fromEntries(entries));
}

function ignoreMissing(error: unknown): undefined {
	if (isRecord(error) && error["code"] === "ENOENT") {
		return undefined;
	}
	throw error;
}

function nameOrUndefined(name: unknown): string | undefined {
	return typeof name === "string" && name !== "" ? name : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
