import { basename } from "node:path";
import type { EventCommand, MoveCommand } from "./commands.js";

/*
 * Typed views of the MV data files that hold event logic.
 *
 * These describe the parsed JSON as it is; nothing is converted into classes. Plugins often add
 * their own fields, and MV writes some objects' keys in varying orders, so every type allows
 * unknown keys and data is saved exactly as it was loaded (see `mv-json.ts`).
 *
 * Ids: the engine finds common events, map events and troops by their position in the file's
 * array (`$dataCommonEvents[id]`), so locations below use that position.
 */

/** Keys added by plugins, or not yet described here. */
interface Extensible {
	[key: string]: unknown;
}

export interface CommonEvent extends Extensible {
	id: number;
	name: string;
	/** 0 none (called from other events), 1 autorun, 2 parallel. */
	trigger: number;
	/** The switch that runs an autorun or parallel common event. */
	switchId: number;
	list: EventCommand[];
}

export interface MapInfo extends Extensible {
	id: number;
	name: string;
	/** The map this one is listed under in the editor, or 0 for the top level. */
	parentId: number;
	order: number;
	expanded: boolean;
	scrollX: number;
	scrollY: number;
}

export interface MvMap extends Extensible {
	displayName: string;
	note: string;
	width: number;
	height: number;
	tilesetId: number;
	/** Tile ids: 6 layers of width × height. */
	data: number[];
	/** Events by id. Index 0, and deleted events, are `null`. */
	events: (MapEvent | null)[];
}

export interface MapEvent extends Extensible {
	id: number;
	name: string;
	note: string;
	x: number;
	y: number;
	pages: EventPage[];
}

export interface EventPage extends Extensible {
	conditions: EventPageConditions;
	image: EventImage;
	moveRoute: MoveRoute;
	/** 0 action button, 1 player touch, 2 event touch, 3 autorun, 4 parallel. */
	trigger: number;
	/** 0 below characters, 1 same as characters, 2 above characters. */
	priorityType: number;
	/** 0 fixed, 1 random, 2 approach, 3 custom. */
	moveType: number;
	moveSpeed: number;
	moveFrequency: number;
	directionFix: boolean;
	stepAnime: boolean;
	through: boolean;
	walkAnime: boolean;
	list: EventCommand[];
}

/** When a map event page is active. Each check only applies when its `…Valid` flag is set. */
export interface EventPageConditions extends Extensible {
	switch1Valid: boolean;
	switch1Id: number;
	switch2Valid: boolean;
	switch2Id: number;
	/** The variable must be at least `variableValue`. */
	variableValid: boolean;
	variableId: number;
	variableValue: number;
	selfSwitchValid: boolean;
	/** "A", "B", "C" or "D". */
	selfSwitchCh: string;
	itemValid: boolean;
	itemId: number;
	actorValid: boolean;
	actorId: number;
}

export interface EventImage extends Extensible {
	tileId: number;
	characterName: string;
	characterIndex: number;
	/** 2 down, 4 left, 6 right, 8 up. */
	direction: number;
	pattern: number;
}

export interface MoveRoute extends Extensible {
	list: MoveCommand[];
	repeat: boolean;
	skippable: boolean;
	wait: boolean;
}

export interface Troop extends Extensible {
	id: number;
	name: string;
	members: TroopMember[];
	pages: TroopPage[];
}

export interface TroopMember extends Extensible {
	enemyId: number;
	x: number;
	y: number;
	hidden: boolean;
}

export interface TroopPage extends Extensible {
	conditions: TroopPageConditions;
	/** 0 once per battle, 1 once per turn, 2 every moment the conditions hold. */
	span: number;
	list: EventCommand[];
}

/** When a troop page runs. Each check only applies when its `…Valid` flag is set. */
export interface TroopPageConditions extends Extensible {
	turnEnding: boolean;
	/** Turn `turnA + turnB * n`. */
	turnValid: boolean;
	turnA: number;
	turnB: number;
	/** The enemy at `enemyIndex` has at most `enemyHp` percent HP. */
	enemyValid: boolean;
	enemyIndex: number;
	enemyHp: number;
	/** The actor has at most `actorHp` percent HP. */
	actorValid: boolean;
	actorId: number;
	actorHp: number;
	switchValid: boolean;
	switchId: number;
}

/** A data file doesn't have the shape these types describe. */
export class MvDataError extends Error {
	constructor(
		readonly file: string,
		/** Where in the file, for example `[12].list[3].code`. */
		readonly path: string,
		detail: string,
	) {
		super(`${file} ${path}: ${detail}`);
		this.name = "MvDataError";
	}
}

/** Checks the parsed content of `CommonEvents.json`. Returns the same array, typed. */
export function asCommonEvents(value: unknown, file = "CommonEvents.json"): (CommonEvent | null)[] {
	return checkEntries(value, new Checker(file), (entry, check) => {
		check.integer(entry, "id");
		check.string(entry, "name");
		check.integer(entry, "trigger");
		check.integer(entry, "switchId");
		check.commandList(entry, "list");
	});
}

/** Checks the parsed content of `MapInfos.json`. Returns the same array, typed. */
export function asMapInfos(value: unknown, file = "MapInfos.json"): (MapInfo | null)[] {
	return checkEntries(value, new Checker(file), (entry, check) => {
		check.integer(entry, "id");
		check.string(entry, "name");
		check.integer(entry, "parentId");
		check.integer(entry, "order");
	});
}

/** Checks the parsed content of `Troops.json`. Returns the same array, typed. */
export function asTroops(value: unknown, file = "Troops.json"): (Troop | null)[] {
	return checkEntries(value, new Checker(file), (entry, check) => {
		check.integer(entry, "id");
		check.string(entry, "name");
		check.each(entry, "members", (member, memberCheck) => {
			memberCheck.integer(member, "enemyId");
		});
		check.each(entry, "pages", (page, pageCheck) => {
			pageCheck.record(page, "conditions");
			pageCheck.integer(page, "span");
			pageCheck.commandList(page, "list");
		});
	});
}

/** Checks the parsed content of a `MapXXX.json` file. Returns the same object, typed. */
export function asMap(value: unknown, file: string): MvMap {
	const check = new Checker(basename(file));
	const map = check.asRecord(value, "");
	check.integer(map, "width");
	check.integer(map, "height");
	check.array(map, "data");
	const events = check.array(map, "events");
	events.forEach((event, index) => {
		if (event === null) {
			return;
		}
		const eventCheck = check.at(`events[${index}]`);
		const record = eventCheck.asRecord(event, "");
		eventCheck.integer(record, "id");
		eventCheck.string(record, "name");
		eventCheck.integer(record, "x");
		eventCheck.integer(record, "y");
		eventCheck.each(record, "pages", (page, pageCheck) => {
			pageCheck.record(page, "conditions");
			pageCheck.record(page, "image");
			pageCheck.integer(page, "trigger");
			const route = pageCheck.record(page, "moveRoute");
			pageCheck.at("moveRoute").each(route, "list", (step, stepCheck) => {
				stepCheck.integer(step, "code");
			});
			pageCheck.commandList(page, "list");
		});
	});
	return value as MvMap;
}

/** The map id in a `MapXXX.json` file name, or `undefined` for other files. */
export function mapIdFromFileName(fileName: string): number | undefined {
	const match = /^Map(\d+)\.json$/i.exec(basename(fileName));
	return match ? Number(match[1]) : undefined;
}

/** Where a command list lives in a project. Page indexes start at 0. */
export type ListLocation =
	| { kind: "commonEvent"; commonEventId: number }
	| { kind: "mapEvent"; mapId: number; eventId: number; pageIndex: number }
	| { kind: "troop"; troopId: number; pageIndex: number };

export interface LocatedCommandList {
	location: ListLocation;
	list: EventCommand[];
}

/** A short, stable string for a location, usable as a map key. */
export function locationKey(location: ListLocation): string {
	switch (location.kind) {
		case "commonEvent":
			return `commonEvent:${location.commonEventId}`;
		case "mapEvent":
			return `mapEvent:${location.mapId}:${location.eventId}:${location.pageIndex}`;
		case "troop":
			return `troop:${location.troopId}:${location.pageIndex}`;
	}
}

/** A location as people read it, with pages numbered from 1 as in the editor. */
export function describeLocation(location: ListLocation): string {
	switch (location.kind) {
		case "commonEvent":
			return `Common event ${location.commonEventId}`;
		case "mapEvent":
			return `Map ${location.mapId}, event ${location.eventId}, page ${location.pageIndex + 1}`;
		case "troop":
			return `Troop ${location.troopId}, page ${location.pageIndex + 1}`;
	}
}

/** Every common event's command list. */
export function* commonEventLists(
	commonEvents: readonly (CommonEvent | null)[],
): Generator<LocatedCommandList> {
	for (const [commonEventId, event] of commonEvents.entries()) {
		if (event) {
			yield { location: { kind: "commonEvent", commonEventId }, list: event.list };
		}
	}
}

/** Every page's command list for every event on a map. */
export function* mapEventLists(mapId: number, map: MvMap): Generator<LocatedCommandList> {
	for (const [eventId, event] of map.events.entries()) {
		for (const [pageIndex, page] of (event?.pages ?? []).entries()) {
			yield { location: { kind: "mapEvent", mapId, eventId, pageIndex }, list: page.list };
		}
	}
}

/** Every page's command list for every troop. */
export function* troopLists(troops: readonly (Troop | null)[]): Generator<LocatedCommandList> {
	for (const [troopId, troop] of troops.entries()) {
		for (const [pageIndex, page] of (troop?.pages ?? []).entries()) {
			yield { location: { kind: "troop", troopId, pageIndex }, list: page.list };
		}
	}
}

type JsonRecord = Record<string, unknown>;

/** Checks for an array of `null` or records, as in MV's database files. */
function checkEntries<T>(
	value: unknown,
	check: Checker,
	checkEntry: (entry: JsonRecord, check: Checker) => void,
): (T | null)[] {
	if (!Array.isArray(value)) {
		throw new MvDataError(check.file, "(top level)", "expected an array");
	}
	value.forEach((entry, index) => {
		if (entry !== null) {
			const entryCheck = check.at(`[${index}]`);
			checkEntry(entryCheck.asRecord(entry, ""), entryCheck);
		}
	});
	return value as (T | null)[];
}

/** Small helpers that report problems with the file and path of the offending value. */
class Checker {
	constructor(
		readonly file: string,
		private readonly path = "",
	) {}

	at(path: string): Checker {
		return new Checker(this.file, this.join(path));
	}

	asRecord(value: unknown, key: string): JsonRecord {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			this.fail(key, "expected an object");
		}
		return value as JsonRecord;
	}

	record(parent: JsonRecord, key: string): JsonRecord {
		return this.asRecord(parent[key], key);
	}

	array(parent: JsonRecord, key: string): unknown[] {
		const value = parent[key];
		if (!Array.isArray(value)) {
			this.fail(key, "expected an array");
		}
		return value;
	}

	integer(parent: JsonRecord, key: string): void {
		if (!Number.isInteger(parent[key])) {
			this.fail(key, `expected an integer, got ${JSON.stringify(parent[key])}`);
		}
	}

	string(parent: JsonRecord, key: string): void {
		if (typeof parent[key] !== "string") {
			this.fail(key, `expected a string, got ${JSON.stringify(parent[key])}`);
		}
	}

	/** Checks that `parent[key]` is an array of objects, checking each with `checkItem`. */
	each(parent: JsonRecord, key: string, checkItem: (item: JsonRecord, check: Checker) => void) {
		this.array(parent, key).forEach((item, index) => {
			const itemCheck = this.at(`${key}[${index}]`);
			checkItem(itemCheck.asRecord(item, ""), itemCheck);
		});
	}

	commandList(parent: JsonRecord, key: string): void {
		this.each(parent, key, (command, check) => {
			check.integer(command, "code");
			check.integer(command, "indent");
			check.array(command, "parameters");
		});
	}

	private join(key: string): string {
		if (key === "") {
			return this.path;
		}
		if (this.path === "" || key.startsWith("[")) {
			return `${this.path}${key}`;
		}
		return `${this.path}.${key}`;
	}

	private fail(key: string, detail: string): never {
		throw new MvDataError(this.file, this.join(key) || "(top level)", detail);
	}
}
