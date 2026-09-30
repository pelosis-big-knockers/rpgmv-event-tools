/**
 * Script expressions for MV concepts that more than one command uses: the running event, other
 * characters and troop members (see `docs/script-syntax.md`, sections 5.4 and 5.5), audio and
 * JavaScript values.
 */
import { isExpressionBody } from "./javascript.js";
import {
	codeLambda,
	computedMember,
	identifier,
	member,
	numberLiteral,
	scriptString,
	type Expr,
} from "./script-docs.js";
import { isIdentifierName, type SymbolKey } from "./symbols.js";

/** An audio parameter's keys, in the order MV writes them. */
const AUDIO_KEYS = ["name", "volume", "pitch", "pan"];
/** The MV editor's audio defaults, left out of the options. */
const AUDIO_DEFAULTS = [
	["volume", 90],
	["pitch", 100],
	["pan", 0],
] as const;

/**
 * An audio parameter, `{ name, volume, pitch, pan }`: the name as a string, and options for the
 * values that aren't MV's defaults (volume 90, pitch 100, pan 0). `undefined` unless the object
 * has exactly MV's keys, in MV's order, a name without line breaks and numbers for the rest.
 */
export function audio(
	value: unknown,
): [name: Expr, options: [key: string, value: Expr][]] | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	const name = record["name"];
	if (
		keys.length !== AUDIO_KEYS.length ||
		keys.some((key, index) => key !== AUDIO_KEYS[index]) ||
		typeof name !== "string" ||
		/[\r\n]/.test(name)
	) {
		return undefined;
	}
	const options: [key: string, value: Expr][] = [];
	for (const [key, fallback] of AUDIO_DEFAULTS) {
		const setting = record[key];
		if (typeof setting !== "number" || !Number.isFinite(setting)) {
			return undefined;
		}
		if (setting !== fallback) {
			options.push([key, numberLiteral(setting)]);
		}
	}
	return [scriptString(name), options];
}

/** The body's parameter for the running event. */
export const EVENT = identifier("event");

/** `troop.members[index]`: a member of the current battle's troop, from 0. */
export function troopMember(index: number): Expr {
	return computedMember(member(identifier("troop"), "members"), numberLiteral(index));
}

/**
 * The names of one map's events, for referring to them as `map.events.Name`. Names follow the
 * symbol table's rules (spec 5.2) among the events of that map: an identifier used by no other
 * event prints as a property, another unique non-empty name in brackets, and anything else as
 * the id.
 */
export class MapEventNames {
	readonly #names: readonly (string | undefined)[];
	readonly #counts = new Map<string, number>();

	/** The map's events by id, as in a map file: index 0 and deleted events are `null`. */
	constructor(events: readonly ({ readonly name?: unknown } | null | undefined)[]) {
		this.#names = events.map((event) =>
			typeof event?.name === "string" && event.name !== "" ? event.name : undefined,
		);
		for (const name of this.#names) {
			if (name !== undefined) {
				this.#counts.set(name, (this.#counts.get(name) ?? 0) + 1);
			}
		}
	}

	/** How to refer to event `id` of the map. */
	key(id: number): SymbolKey {
		const name = id > 0 ? this.#names[id] : undefined;
		if (name === undefined || this.#counts.get(name) !== 1) {
			return { form: "id", id };
		}
		return { form: isIdentifierName(name) ? "property" : "string", name };
	}
}

/**
 * A character by MV's number: `player` (-1), the running `event` (0), or another event of the
 * current map, by name when `names` has one (`map.events.Gate`) and otherwise by id
 * (`map.events[12]`). `useEvent` is called when the running event is used. Returns `undefined`
 * for other numbers.
 */
export function character(
	id: unknown,
	useEvent: () => void,
	names?: MapEventNames,
): Expr | undefined {
	if (id === -1) {
		return identifier("player");
	}
	if (id === 0) {
		useEvent();
		return EVENT;
	}
	if (!Number.isInteger(id) || (id as number) <= 0) {
		return undefined;
	}
	const events = member(identifier("map"), "events");
	const key: SymbolKey = names?.key(id as number) ?? { form: "id", id: id as number };
	switch (key.form) {
		case "property":
			return member(events, key.name);
		case "string":
			return computedMember(events, scriptString(key.name));
		case "id":
			return computedMember(events, numberLiteral(key.id));
	}
}

/** A value's name in a table indexed by value, or `undefined` if it has none. */
export function nameOf(
	names: Readonly<Record<number, string>>,
	value: unknown,
): string | undefined {
	return typeof value === "number" ? names[value] : undefined;
}

/**
 * The argument of a `script(…)` call for one piece of JavaScript that is a value (a script
 * condition or operand, or the move-route step): `() => code` when it is one expression that
 * reads back exactly, and otherwise the code as a string (spec 8.2). `undefined` if `code` isn't
 * a string without line breaks, which neither form can hold.
 */
export function scriptArgument(code: unknown): Expr | undefined {
	if (typeof code !== "string") {
		return undefined;
	}
	if (isExpressionBody(code)) {
		return codeLambda(code);
	}
	return /[\r\n]/.test(code) ? undefined : scriptString(code);
}
