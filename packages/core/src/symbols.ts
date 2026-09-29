/**
 * The symbol table: how scripts refer to switches, variables and database entries.
 *
 * A reference is a collection followed by a name or id, in one of three forms:
 *
 * - `property`: `switches.Guard_Thrust`, when the name is an identifier used by no other id of
 *   the same kind
 * - `string`: `switches["Light on"]`, when the name is unique but not an identifier
 * - `id`: `switches[35]`, when the name is empty, or shared by several ids of that kind
 *
 * Names are compared exactly (case-sensitive). The id form is always accepted when resolving.
 */
import type { MvNames, NamedKind } from "./names.js";
import { formatStringLiteral, parseStringLiteral } from "./string-literals.js";

/** The collection that scripts use for each kind. */
export const SYMBOL_COLLECTIONS = {
	switch: "switches",
	variable: "variables",
	commonEvent: "commonEvents",
	actor: "actors",
	class: "classes",
	skill: "skills",
	item: "items",
	weapon: "weapons",
	armor: "armors",
	enemy: "enemies",
	troop: "troops",
	state: "states",
	animation: "animations",
	tileset: "tilesets",
	map: "maps",
	element: "elements",
	skillType: "skillTypes",
	weaponType: "weaponTypes",
	armorType: "armorTypes",
	equipType: "equipTypes",
} as const satisfies Record<NamedKind, string>;

export type CollectionName = (typeof SYMBOL_COLLECTIONS)[NamedKind];

const KINDS_BY_COLLECTION: ReadonlyMap<string, NamedKind> = new Map(
	(Object.entries(SYMBOL_COLLECTIONS) as [NamedKind, CollectionName][]).map(([kind, name]) => [
		name,
		kind,
	]),
);

/** The script collection for `kind`, for example `switches` for `switch`. */
export function collectionName(kind: NamedKind): CollectionName {
	return SYMBOL_COLLECTIONS[kind];
}

/** The kind a script collection holds, or `undefined` if `name` isn't a collection. */
export function kindOfCollection(name: string): NamedKind | undefined {
	return KINDS_BY_COLLECTION.get(name);
}

/** What follows the collection in a reference: a name (either form) or an id. */
export type SymbolKey = { form: "property" | "string"; name: string } | { form: "id"; id: number };

/** A reference to entry `id` of `kind`, in the form the formatter chose for it. */
export type SymbolReference = { kind: NamedKind; id: number } & SymbolKey;

/**
 * The outcome of resolving a reference. `ok` references give the id. Unknown and ambiguous
 * names are not errors to throw but results to report: `candidates` are the ids sharing an
 * ambiguous name, or for an unknown name the ids whose name differs only in case.
 */
export type SymbolResolution =
	| {
			ok: true;
			id: number;
			/** False for an id form naming a slot that doesn't exist (out of range). */
			inRange: boolean;
	  }
	| { ok: false; error: "unknown" | "ambiguous"; name: string; candidates: readonly number[] };

/**
 * Converts between ids and script references for one project's names. Build it with
 * `createSymbols` or use `MvProject.symbols`.
 */
export class MvSymbols {
	readonly #names: MvNames;
	/** Ids by exact name, per kind, built the first time a kind is used. */
	readonly #ids = new Map<NamedKind, ReadonlyMap<string, readonly number[]>>();

	constructor(names: MvNames) {
		this.#names = names;
	}

	/** How to refer to entry `id` of `kind`. Out-of-range ids get the id form. */
	reference(kind: NamedKind, id: number): SymbolReference {
		const name = this.#names.of(kind, id);
		if (name === undefined || this.idsNamed(kind, name).length !== 1) {
			return { kind, id, form: "id" };
		}
		return { kind, id, form: isIdentifierName(name) ? "property" : "string", name };
	}

	/** The script text for entry `id` of `kind`, for example `switches.Guard_Thrust`. */
	format(kind: NamedKind, id: number): string {
		return formatSymbolReference(this.reference(kind, id));
	}

	/**
	 * The id a reference points to. The id form resolves to its id whether or not that slot
	 * exists, so references to missing entries round-trip; `inRange` says whether it does.
	 */
	resolve(kind: NamedKind, key: SymbolKey): SymbolResolution {
		if (key.form === "id") {
			return { ok: true, id: key.id, inRange: this.#inRange(kind, key.id) };
		}
		return this.resolveName(kind, key.name);
	}

	/** The id of the only entry of `kind` named exactly `name`. */
	resolveName(kind: NamedKind, name: string): SymbolResolution {
		const ids = this.idsNamed(kind, name);
		if (ids.length === 1) {
			return { ok: true, id: ids[0]!, inRange: true };
		}
		if (ids.length > 1) {
			return { ok: false, error: "ambiguous", name, candidates: ids };
		}
		const lower = name.toLowerCase();
		const candidates = [...this.#index(kind)]
			.filter(([other]) => other.toLowerCase() === lower)
			.flatMap(([, ids]) => ids)
			.sort((a, b) => a - b);
		return { ok: false, error: "unknown", name, candidates };
	}

	/** Ids of every entry of `kind` named exactly `name`, in ascending order. */
	idsNamed(kind: NamedKind, name: string): readonly number[] {
		return this.#index(kind).get(name) ?? [];
	}

	#inRange(kind: NamedKind, id: number): boolean {
		return Number.isInteger(id) && id >= 1 && id <= this.#names.count(kind);
	}

	#index(kind: NamedKind): ReadonlyMap<string, readonly number[]> {
		let index = this.#ids.get(kind);
		if (!index) {
			const built = new Map<string, number[]>();
			for (let id = 1; id <= this.#names.count(kind); id++) {
				const name = this.#names.of(kind, id);
				if (name !== undefined) {
					const ids = built.get(name);
					if (ids) {
						ids.push(id);
					} else {
						built.set(name, [id]);
					}
				}
			}
			index = built;
			this.#ids.set(kind, index);
		}
		return index;
	}
}

export function createSymbols(names: MvNames): MvSymbols {
	return new MvSymbols(names);
}

/** The script text for a reference: `switches.Name`, `switches["Some name"]` or `switches[3]`. */
export function formatSymbolReference(reference: SymbolReference): string {
	const collection = SYMBOL_COLLECTIONS[reference.kind];
	switch (reference.form) {
		case "property":
			return `${collection}.${reference.name}`;
		case "string":
			return `${collection}[${formatStringLiteral(reference.name)}]`;
		case "id":
			return `${collection}[${reference.id}]`;
	}
}

/** A reference read by `parseSymbolReference`. */
export interface ParsedSymbolReference {
	kind: NamedKind;
	key: SymbolKey;
	/** Offset just past the reference. */
	end: number;
}

/**
 * Reads a reference in any of the three forms starting at `offset`, without resolving it.
 * Returns `undefined` if the text there isn't a reference to a known collection. Spaces are
 * allowed inside the brackets; ids are written in decimal.
 */
export function parseSymbolReference(
	source: string,
	offset = 0,
): ParsedSymbolReference | undefined {
	const collection = matchAt(IDENTIFIER_AT, source, offset);
	const kind = collection && kindOfCollection(collection.text);
	if (!collection || !kind) {
		return undefined;
	}
	const dot = matchAt(/\./y, source, collection.end);
	if (dot) {
		const name = matchAt(IDENTIFIER_AT, source, dot.end);
		return name && { kind, key: { form: "property", name: name.text }, end: name.end };
	}
	const open = matchAt(/\s*\[\s*/y, source, collection.end);
	if (!open) {
		return undefined;
	}
	let key: SymbolKey;
	let position: number;
	const digits = matchAt(/\d+/y, source, open.end);
	if (digits) {
		key = { form: "id", id: Number(digits.text) };
		position = digits.end;
	} else {
		const literal = parseStringLiteral(source, open.end);
		if (!literal?.ok) {
			return undefined;
		}
		key = { form: "string", name: literal.value };
		position = literal.end;
	}
	const close = matchAt(/\s*\]/y, source, position);
	return close && { kind, key, end: close.end };
}

/** Matches the sticky pattern `pattern` at `offset`. */
function matchAt(
	pattern: RegExp,
	source: string,
	offset: number,
): { text: string; end: number } | undefined {
	pattern.lastIndex = offset;
	const text = pattern.exec(source)?.[0];
	return text === undefined ? undefined : { text, end: pattern.lastIndex };
}

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;
const IDENTIFIER_AT = /[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*/uy;

/**
 * Whether `name` is an identifier, so it can follow a `.`. Reserved words count: `x.if` is
 * valid. Use `isDeclarableName` where the name declares a function or class.
 */
export function isIdentifierName(name: string): boolean {
	return IDENTIFIER.test(name);
}

/**
 * JavaScript's reserved words, including those reserved only in strict mode and modules, plus
 * `eval` and `arguments`, which strict mode doesn't allow as declared names.
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set(
	[
		"break case catch class const continue debugger default delete do else enum export extends",
		"false finally for function if import in instanceof new null return super switch this throw",
		"true try typeof var void while with",
		"implements interface let package private protected public static yield await",
		"eval arguments",
	]
		.join(" ")
		.split(" "),
);

/** Whether `name` is a reserved word, which can't name a function or class. */
export function isReservedWord(name: string): boolean {
	return RESERVED_WORDS.has(name);
}

/** Whether `name` can name a declared function or class: an identifier, not a reserved word. */
export function isDeclarableName(name: string): boolean {
	return isIdentifierName(name) && !isReservedWord(name);
}
