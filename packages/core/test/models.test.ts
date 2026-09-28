import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	MvDataError,
	asCommonEvents,
	asMap,
	asMapInfos,
	asTroops,
	commonEventLists,
	describeLocation,
	locationKey,
	mapEventLists,
	mapIdFromFileName,
	parseMvJson,
	readMvFile,
	stringifyMvJson,
	troopLists,
	type LocatedCommandList,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

const fixtureData = fileURLToPath(new URL("./fixtures/basic/data", import.meta.url));
const readFixture = (name: string) => readMvFile(join(fixtureData, name));

describe("typed models on the basic fixture", () => {
	it("reads common events and lists their commands", async () => {
		const events = asCommonEvents(await readFixture("CommonEvents.json"));
		expect(events[1]?.name).toBe("Toggle lantern");
		expect(events[1]?.list[0]).toEqual({ code: 111, indent: 0, parameters: [0, 2, 0] });

		const lists = [...commonEventLists(events)];
		expect(lists.map((entry) => describeLocation(entry.location))).toEqual([
			"Common event 1",
			"Common event 2",
			"Common event 3",
		]);
	});

	it("reads a map's events and pages", async () => {
		const map = asMap(await readFixture("Map001.json"), "Map001.json");
		expect(map.width).toBe(4);
		const keeper = map.events[1];
		expect(keeper?.name).toBe("Keeper");
		expect(keeper?.pages[1]?.conditions).toMatchObject({ switch1Valid: true, switch1Id: 3 });
		expect(keeper?.pages[0]?.moveRoute.list).toEqual([{ code: 0, parameters: [] }]);

		const lists = [...mapEventLists(1, map)];
		expect(lists.map((entry) => describeLocation(entry.location))).toEqual([
			"Map 1, event 1, page 1",
			"Map 1, event 1, page 2",
		]);
	});

	it("reads troops and their pages", async () => {
		const troops = asTroops(await readFixture("Troops.json"));
		expect(troops[1]?.members).toHaveLength(2);
		expect(troops[1]?.pages[0]?.conditions).toMatchObject({ turnValid: true, turnA: 1 });
		expect([...troopLists(troops)].map((entry) => locationKey(entry.location))).toEqual([
			"troop:1:0",
			"troop:1:1",
		]);
	});

	it("reads map infos", async () => {
		const infos = asMapInfos(await readFixture("MapInfos.json"));
		expect(infos[1]).toMatchObject({ id: 1, name: "Keeper's House", parentId: 0 });
	});

	it("returns the parsed data unchanged, so it saves byte for byte", async () => {
		for (const [file, check] of [
			["CommonEvents.json", asCommonEvents],
			["Troops.json", asTroops],
			["MapInfos.json", asMapInfos],
			["Map001.json", (value: unknown) => asMap(value, "Map001.json")],
		] as const) {
			const text = await readFile(join(fixtureData, file), "utf8");
			const parsed = parseMvJson(text);
			expect(check(parsed)).toBe(parsed);
			expect(stringifyMvJson(file, parsed)).toBe(text);
		}
	});
});

describe("unknown keys", () => {
	it("are kept, in their original order", () => {
		const text =
			'[\nnull,\n{"pluginData":{"b":1,"a":2},"id":1,"list":[],"name":"A","switchId":1,"trigger":0}\n]';
		const events = asCommonEvents(parseMvJson(text));
		expect(events[1]?.["pluginData"]).toEqual({ b: 1, a: 2 });
		expect(stringifyMvJson("CommonEvents.json", events)).toBe(text);
	});
});

describe("shape errors", () => {
	const commonEvent = (list: unknown) => [
		null,
		{ id: 1, name: "A", switchId: 1, trigger: 0, list },
	];

	it("name the file and the path of the bad value", () => {
		expect(() =>
			asCommonEvents(commonEvent([{ code: 101, indent: 0, parameters: [] }, { code: "x" }])),
		).toThrow(
			new MvDataError("CommonEvents.json", "[1].list[1].code", 'expected an integer, got "x"'),
		);

		expect(() => asTroops([null, { id: 1, name: "T", members: [], pages: [{ span: 0 }] }])).toThrow(
			"Troops.json [1].pages[0].conditions: expected an object",
		);

		expect(() =>
			asMap(
				{ width: 1, height: 1, data: [], events: [null, { id: 1, name: "E", x: 0, y: 0 }] },
				"Map007.json",
			),
		).toThrow("Map007.json events[1].pages: expected an array");
	});

	it("reject files that aren't arrays or objects at the top level", () => {
		expect(() => asCommonEvents({})).toThrow("CommonEvents.json (top level): expected an array");
		expect(() => asMap([], "Map001.json")).toThrow("Map001.json (top level): expected an object");
	});

	it("accept null entries (unused slots and deleted events)", () => {
		expect(asCommonEvents([null, null])).toEqual([null, null]);
	});
});

describe("mapIdFromFileName", () => {
	it("reads the id from map file names only", () => {
		expect(mapIdFromFileName("Map001.json")).toBe(1);
		expect(mapIdFromFileName(join("www", "data", "Map123.json"))).toBe(123);
		expect(mapIdFromFileName("MapInfos.json")).toBeUndefined();
	});
});

describeWithGame("typed models on the configured test game", (game) => {
	it("checks every event container and finds every command list", async () => {
		const read = (file: string) => readMvFile(join(game.dataDir, file));
		const lists: LocatedCommandList[] = [
			...commonEventLists(asCommonEvents(await read("CommonEvents.json"))),
			...troopLists(asTroops(await read("Troops.json"))),
		];
		asMapInfos(await read("MapInfos.json"));

		let pages = 0;
		for (const file of await readdir(game.dataDir)) {
			const mapId = mapIdFromFileName(file);
			if (mapId !== undefined) {
				const map = asMap(await read(file), file);
				pages += map.events.reduce((sum, event) => sum + (event?.pages.length ?? 0), 0);
				lists.push(...mapEventLists(mapId, map));
			}
		}

		expect(lists.filter((entry) => entry.location.kind === "mapEvent")).toHaveLength(pages);
		expect(new Set(lists.map((entry) => locationKey(entry.location))).size).toBe(lists.length);
		expect(lists.every((entry) => entry.list.length > 0)).toBe(true);
	});
});
