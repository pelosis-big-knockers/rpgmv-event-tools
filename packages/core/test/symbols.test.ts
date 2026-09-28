import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	SYMBOL_COLLECTIONS,
	collectionName,
	createNames,
	createSymbols,
	formatSymbolReference,
	isDeclarableName,
	isIdentifierName,
	isReservedWord,
	kindOfCollection,
	loadProject,
	parseSymbolReference,
	type MvSymbols,
	type NamedKind,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

const fixtureData = fileURLToPath(new URL("./fixtures/basic/data", import.meta.url));

/** Formats entry `id`, parses the text back and resolves it, returning the id it lands on. */
function roundTrip(symbols: MvSymbols, kind: NamedKind, id: number): number | undefined {
	const text = symbols.format(kind, id);
	const parsed = parseSymbolReference(text);
	if (!parsed || parsed.kind !== kind || parsed.end !== text.length) {
		return undefined;
	}
	const resolved = symbols.resolve(kind, parsed.key);
	return resolved.ok ? resolved.id : undefined;
}

describe("symbol table on inline data", () => {
	const switches = [
		"",
		"Guard_Thrust", // 1: identifier
		"Light on", // 2: not an identifier
		"crate1", // 3: shared with 5
		"", // 4: empty
		"crate1", // 5
		`Say "hi"`, // 6
		`Don't say "hi"`, // 7
		"a'b`c\"d", // 8: all three delimiters
		"if", // 9: reserved word
		"$gold_2", // 10
		"ランタン", // 11: non-ASCII identifier
		"9lives", // 12
		"ends with \\", // 13
		"Crate1", // 14: differs from 3 and 5 only in case
		"12", // 15: looks like an id
	];
	const symbols = createSymbols(
		createNames({ switches }, { item: [null, { id: 1, name: "Potion" }, null] }),
	);

	it("formats identifier names as properties", () => {
		expect(symbols.format("switch", 1)).toBe("switches.Guard_Thrust");
		expect(symbols.format("switch", 10)).toBe("switches.$gold_2");
		expect(symbols.format("switch", 11)).toBe("switches.ランタン");
		expect(symbols.format("switch", 9)).toBe("switches.if");
		expect(symbols.format("item", 1)).toBe("items.Potion");
	});

	it("formats other unique names as strings", () => {
		expect(symbols.format("switch", 2)).toBe(`switches["Light on"]`);
		expect(symbols.format("switch", 6)).toBe(`switches['Say "hi"']`);
		expect(symbols.format("switch", 7)).toBe('switches[`Don\'t say "hi"`]');
		expect(symbols.format("switch", 8)).toBe(`switches["a'b\`c" + '"d']`);
		expect(symbols.format("switch", 12)).toBe(`switches["9lives"]`);
		expect(symbols.format("switch", 13)).toBe(`switches["ends with \\"]`);
		expect(symbols.format("switch", 15)).toBe(`switches["12"]`);
	});

	it("formats empty, shared and out-of-range names as ids", () => {
		expect(symbols.format("switch", 4)).toBe("switches[4]");
		expect(symbols.format("switch", 3)).toBe("switches[3]");
		expect(symbols.format("switch", 5)).toBe("switches[5]");
		expect(symbols.format("switch", 16)).toBe("switches[16]");
		expect(symbols.format("switch", 0)).toBe("switches[0]");
		expect(symbols.format("item", 2)).toBe("items[2]"); // null entry
		expect(symbols.format("actor", 1)).toBe("actors[1]"); // no data at all
	});

	it("gives the structured form of a reference", () => {
		expect(symbols.reference("switch", 1)).toEqual({
			kind: "switch",
			id: 1,
			form: "property",
			name: "Guard_Thrust",
		});
		expect(symbols.reference("switch", 2)).toEqual({
			kind: "switch",
			id: 2,
			form: "string",
			name: "Light on",
		});
		expect(symbols.reference("switch", 3)).toEqual({ kind: "switch", id: 3, form: "id" });
		expect(formatSymbolReference({ kind: "variable", id: 7, form: "id" })).toBe("variables[7]");
	});

	it("resolves names in either form, and ids", () => {
		expect(symbols.resolve("switch", { form: "property", name: "Guard_Thrust" })).toEqual({
			ok: true,
			id: 1,
			inRange: true,
		});
		// A name that would print as a property is still accepted as a string, and vice versa.
		expect(symbols.resolve("switch", { form: "string", name: "Guard_Thrust" })).toMatchObject({
			id: 1,
		});
		expect(symbols.resolve("switch", { form: "string", name: "Light on" })).toMatchObject({
			id: 2,
		});
		expect(symbols.resolve("switch", { form: "id", id: 3 })).toEqual({
			ok: true,
			id: 3,
			inRange: true,
		});
		// "12" is a name (switch 15), not id 12.
		expect(symbols.resolve("switch", { form: "string", name: "12" })).toMatchObject({ id: 15 });
	});

	it("resolves out-of-range ids to themselves, flagged", () => {
		expect(symbols.resolve("switch", { form: "id", id: 16 })).toEqual({
			ok: true,
			id: 16,
			inRange: false,
		});
		expect(symbols.resolve("switch", { form: "id", id: 0 })).toMatchObject({ inRange: false });
		// An empty slot inside the range is still in range.
		expect(symbols.resolve("switch", { form: "id", id: 4 })).toMatchObject({ inRange: true });
	});

	it("reports ambiguous names with the ids that share them", () => {
		expect(symbols.resolveName("switch", "crate1")).toEqual({
			ok: false,
			error: "ambiguous",
			name: "crate1",
			candidates: [3, 5],
		});
	});

	it("reports unknown names, suggesting names that differ only in case", () => {
		expect(symbols.resolveName("switch", "CRATE1")).toEqual({
			ok: false,
			error: "unknown",
			name: "CRATE1",
			candidates: [3, 5, 14],
		});
		expect(symbols.resolveName("switch", "Nothing")).toMatchObject({
			error: "unknown",
			candidates: [],
		});
		// Empty names never resolve: slot 4 is only reachable by id.
		expect(symbols.resolveName("switch", "")).toMatchObject({ error: "unknown" });
		expect(symbols.resolveName("item", "Potion")).toMatchObject({ id: 1 });
		expect(symbols.resolveName("switch", "Potion")).toMatchObject({ error: "unknown" });
	});

	it("lists the ids sharing a name", () => {
		expect(symbols.idsNamed("switch", "crate1")).toEqual([3, 5]);
		expect(symbols.idsNamed("switch", "Light on")).toEqual([2]);
		expect(symbols.idsNamed("switch", "nope")).toEqual([]);
	});

	it("round-trips every id through text", () => {
		for (let id = 0; id <= switches.length + 1; id++) {
			expect(roundTrip(symbols, "switch", id)).toBe(id);
		}
	});
});

describe("parseSymbolReference", () => {
	it("reads all three forms", () => {
		expect(parseSymbolReference("switches.Guard_Thrust")).toEqual({
			kind: "switch",
			key: { form: "property", name: "Guard_Thrust" },
			end: 21,
		});
		expect(parseSymbolReference(`items[ 'Say "hi"' ]`)).toEqual({
			kind: "item",
			key: { form: "string", name: 'Say "hi"' },
			end: 19,
		});
		expect(parseSymbolReference(`maps["a'b\`c" + '"d']`)?.key).toEqual({
			form: "string",
			name: "a'b`c\"d",
		});
		expect(parseSymbolReference("x = commonEvents[12];", 4)).toEqual({
			kind: "commonEvent",
			key: { form: "id", id: 12 },
			end: 20,
		});
	});

	it("stops after the reference", () => {
		expect(parseSymbolReference("variables.Gold + 1")?.end).toBe(14);
	});

	it("rejects unknown collections and malformed references", () => {
		expect(parseSymbolReference("things.Foo")).toBeUndefined();
		expect(parseSymbolReference("switches.")).toBeUndefined();
		expect(parseSymbolReference("switches.9")).toBeUndefined();
		expect(parseSymbolReference("switches[1.5]")).toBeUndefined();
		expect(parseSymbolReference(`switches["open]`)).toBeUndefined();
		expect(parseSymbolReference(`switches["a"`)).toBeUndefined();
		expect(parseSymbolReference("switches")).toBeUndefined();
	});
});

describe("collections", () => {
	it("has one collection per kind, looked up both ways", () => {
		const kinds = Object.keys(SYMBOL_COLLECTIONS) as NamedKind[];
		expect(new Set(Object.values(SYMBOL_COLLECTIONS)).size).toBe(kinds.length);
		for (const kind of kinds) {
			expect(kindOfCollection(collectionName(kind))).toBe(kind);
		}
		expect(collectionName("commonEvent")).toBe("commonEvents");
		expect(collectionName("equipType")).toBe("equipTypes");
		expect(kindOfCollection("enemies")).toBe("enemy");
		expect(kindOfCollection("switch")).toBeUndefined();
		expect(kindOfCollection("toString")).toBeUndefined();
	});
});

describe("identifier and reserved word checks", () => {
	it("accepts identifiers, including reserved words", () => {
		for (const name of ["Guard_Thrust", "_x", "$", "ランタン", "a\u200Cb", "if", "class"]) {
			expect(isIdentifierName(name)).toBe(true);
		}
		for (const name of ["", "Light on", "9lives", "a-b", "a.b", "\u200Cab", "é!"]) {
			expect(isIdentifierName(name)).toBe(false);
		}
	});

	it("knows reserved words, which can't be declared", () => {
		for (const word of ["if", "class", "function", "let", "yield", "await", "enum", "eval"]) {
			expect(isReservedWord(word)).toBe(true);
			expect(isDeclarableName(word)).toBe(false);
		}
		for (const word of ["If", "undefined", "Guard_Thrust", "of"]) {
			expect(isReservedWord(word)).toBe(false);
		}
		expect(isDeclarableName("Guard_Thrust")).toBe(true);
		expect(isDeclarableName("Light on")).toBe(false);
	});
});

describe("symbols of the basic fixture", () => {
	it("formats names from every loaded file", async () => {
		const project = await loadProject({
			gameDir: join(fixtureData, ".."),
			dataDir: fixtureData,
			layout: "flat",
		});
		const { symbols } = project;
		expect(symbols.format("switch", 2)).toBe(`switches["Lantern lit"]`);
		expect(symbols.format("variable", 2)).toBe("variables.Visits");
		expect(symbols.format("actor", 1)).toBe("actors.Keeper");
		expect(symbols.format("actor", 3)).toBe("actors[3]"); // unused slot
		expect(symbols.format("item", 3)).toBe(`items["Rusty Key"]`);
		expect(symbols.format("map", 1)).toBe(`maps["Keeper's House"]`);
		expect(symbols.format("element", 1)).toBe("elements.Fire");
		expect(symbols.format("equipType", 3)).toBe("equipTypes.Head");
		expect(symbols.format("troop", 1)).toBe(`troops["Cellar Bats"]`);
		expect(symbols.format("commonEvent", 3)).toBe(`commonEvents["Count visit"]`);
		expect(symbols.resolveName("actor", "Traveller")).toMatchObject({ id: 2 });
		expect(project.symbols).toBe(symbols); // built once
	});
});

describeWithGame("symbols in the configured test game", (game) => {
	it("formats every id of every kind and resolves it back to the same id", async () => {
		const project = await loadProject(game);
		const { names, symbols } = project;
		const counts: Record<string, { property: number; string: number; id: number }> = {};
		const failures: string[] = [];
		for (const kind of Object.keys(SYMBOL_COLLECTIONS) as NamedKind[]) {
			const count = { property: 0, string: 0, id: 0 };
			// One past the end checks the out-of-range id form too.
			for (let id = 1; id <= names.count(kind) + 1; id++) {
				count[symbols.reference(kind, id).form]++;
				if (roundTrip(symbols, kind, id) !== id) {
					failures.push(`${kind} ${id}: ${symbols.format(kind, id)}`);
				}
			}
			count.id--; // don't count the out-of-range probe
			counts[collectionName(kind)] = count;
		}
		console.log("symbol forms by collection:", counts);
		expect(failures).toEqual([]);
		expect(counts["switches"]!.property).toBeGreaterThan(0);
	});
});
