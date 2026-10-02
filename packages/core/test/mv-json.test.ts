import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	mvJsonLayout,
	parseMvJson,
	readMvFile,
	stringifyMvJson,
	writeMvFile,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

describe("mvJsonLayout", () => {
	it("uses the map layout for MapXXX.json files", () => {
		expect(mvJsonLayout("Map001.json", {})).toBe("map");
		expect(mvJsonLayout(join("www", "data", "Map123.json"), {})).toBe("map");
	});

	it("does not treat MapInfos.json as a map", () => {
		expect(mvJsonLayout("MapInfos.json", [])).toBe("lines");
	});

	it("uses one line per entry for arrays and one line for other objects", () => {
		expect(mvJsonLayout("CommonEvents.json", [null])).toBe("lines");
		expect(mvJsonLayout("System.json", {})).toBe("compact");
	});
});

describe("stringifyMvJson", () => {
	it("writes database arrays one compact entry per line, with no trailing newline", () => {
		const value = [null, { id: 1, name: "A" }, { id: 2, list: [1, 2] }];
		expect(stringifyMvJson("Items.json", value)).toBe(
			'[\nnull,\n{"id":1,"name":"A"},\n{"id":2,"list":[1,2]}\n]',
		);
	});

	it("writes an empty array with the brackets on separate lines", () => {
		expect(stringifyMvJson("Items.json", [])).toBe("[\n]");
	});

	it("writes System.json on one line", () => {
		expect(stringifyMvJson("System.json", { switches: ["", "A"], gameTitle: "T" })).toBe(
			'{"switches":["","A"],"gameTitle":"T"}',
		);
	});

	it("writes maps with settings, data and events on separate lines", () => {
		const map = { width: 1, height: 1, data: [1, 2], events: [null, { id: 1 }] };
		expect(stringifyMvJson("Map001.json", map)).toBe(
			'{\n"width":1,"height":1,\n"data":[1,2],\n"events":[\nnull,\n{"id":1}\n]\n}',
		);
	});

	it("writes a map with no events as an empty events array", () => {
		const map = { width: 1, data: [], events: [] };
		expect(stringifyMvJson("Map002.json", map)).toBe('{\n"width":1,\n"data":[],\n"events":[\n]\n}');
	});

	it("keeps keys in their original order, including unknown ones", () => {
		const value = [null, { zeta: 1, id: 1, pluginField: { b: 2, a: 1 } }];
		expect(stringifyMvJson("Weapons.json", value)).toBe(
			'[\nnull,\n{"zeta":1,"id":1,"pluginField":{"b":2,"a":1}}\n]',
		);
	});

	it("does not escape non-ASCII text", () => {
		expect(stringifyMvJson("System.json", { gameTitle: "Café 日本" })).toBe(
			'{"gameTitle":"Café 日本"}',
		);
	});

	it("rejects map files without data or events arrays", () => {
		expect(() => stringifyMvJson("Map001.json", { data: [] })).toThrow(
			'Map001.json: a map file must have "data" and "events" arrays',
		);
		expect(() => stringifyMvJson("Map001.json", [])).toThrow("must hold a JSON object");
	});
});

describe("parseMvJson", () => {
	it("ignores a UTF-8 byte order mark", () => {
		expect(parseMvJson("\uFEFF[\nnull\n]")).toEqual([null]);
	});
});

describe("readMvFile and writeMvFile", () => {
	it("write in the editor layout and read back the same value", async () => {
		const dir = mkdtempSync(join(tmpdir(), "rpgmv-json-"));
		try {
			const path = join(dir, "Troops.json");
			const value = [null, { id: 1, name: "Bats", pages: [] }];
			await writeMvFile(path, value);
			expect(readFileSync(path, "utf8")).toBe('[\nnull,\n{"id":1,"name":"Bats","pages":[]}\n]');
			expect(await readMvFile(path)).toEqual(value);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads a file that starts with a byte order mark", async () => {
		const dir = mkdtempSync(join(tmpdir(), "rpgmv-json-"));
		try {
			const path = join(dir, "System.json");
			writeFileSync(path, '\uFEFF{"gameTitle":"T"}', "utf8");
			expect(await readMvFile(path)).toEqual({ gameTitle: "T" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("fixtures", () => {
	const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
	const files = readdirSync(fixturesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) =>
			readdirSync(join(fixturesDir, entry.name, "data"))
				.filter((name) => name.endsWith(".json"))
				.map((name) => join(entry.name, "data", name)),
		);

	it.each(files)("%s round-trips byte for byte", (file) => {
		const name = basename(file);
		const original = readFileSync(join(fixturesDir, file));
		const rewritten = Buffer.from(stringifyMvJson(name, parseMvJson(original.toString("utf8"))));
		expect(rewritten.equals(original)).toBe(true);
	});
});

describeWithGame("MV JSON round trip on the configured test game", (game) => {
	it("re-serializes every data file byte for byte", async () => {
		const names = (await readdir(game.dataDir)).filter((name) => name.endsWith(".json"));
		expect(names.length).toBeGreaterThan(0);

		const mismatches: string[] = [];
		for (const name of names) {
			const original = await readFile(join(game.dataDir, name));
			const rewritten = Buffer.from(stringifyMvJson(name, parseMvJson(original.toString("utf8"))));
			if (!rewritten.equals(original)) {
				mismatches.push(`${name} (${describeDifference(original, rewritten)})`);
			}
		}
		expect(mismatches).toEqual([]);
	});
});

/** A short description of where two buffers first differ, for readable test failures. */
function describeDifference(original: Buffer, rewritten: Buffer): string {
	const length = Math.min(original.length, rewritten.length);
	let offset = 0;
	while (offset < length && original[offset] === rewritten[offset]) {
		offset++;
	}
	const around = (buffer: Buffer) =>
		JSON.stringify(buffer.subarray(Math.max(0, offset - 20), offset + 20).toString("utf8"));
	return `first difference at byte ${offset} of ${original.length}: expected ${around(original)}, got ${around(rewritten)}`;
}
