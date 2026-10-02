import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, type MapEvent, type MapInfo, type MvProject } from "@rpgmv-event-tools/core";
import { describe, expect, it } from "vitest";
import { ExplorerFilter, listedParentId, loadMaps } from "../src/explorer-filter.js";
import { ExplorerTree, type ExplorerNode } from "../src/explorer-tree.js";

const FIXTURE = fileURLToPath(new URL("../../core/test/fixtures/explorer", import.meta.url));

function filter(text: string): ExplorerFilter {
	return ExplorerFilter.parse(text) ?? expect.fail(`"${text}" made no filter`);
}

function mapInfo(id: number, name: string, parentId = 0): MapInfo {
	return { id, name, parentId, order: id, expanded: false, scrollX: 0, scrollY: 0 };
}

function mapEvent(id: number, name: string): MapEvent {
	return { id, name, note: "", x: 0, y: 0, pages: [] };
}

/** MapInfos with: 1 Overworld > 2 Castle > 3 Throne room, 4 Caves, and 5 whose parent is 9. */
const INFOS = [
	null,
	mapInfo(1, "Overworld"),
	mapInfo(2, "Castle", 1),
	mapInfo(3, "Throne room", 2),
	mapInfo(4, "Caves"),
	mapInfo(5, "Lost", 9),
];

/** Events of maps 3 and 4; the other maps aren't loaded. */
const EVENTS: Record<number, (MapEvent | null)[]> = {
	3: [null, mapEvent(1, "King"), null, mapEvent(3, "Guard")],
	4: [null, mapEvent(1, "Bat"), mapEvent(2, "Chest")],
};

function mapsToShow(text: string): number[] {
	return [...filter(text).mapsToShow(INFOS, (mapId) => EVENTS[mapId])].sort();
}

describe("ExplorerFilter", () => {
	it("makes no filter from blank text, and trims it", () => {
		expect(ExplorerFilter.parse("")).toBeUndefined();
		expect(ExplorerFilter.parse("  \t")).toBeUndefined();
		expect(ExplorerFilter.parse("  gate ")?.text).toBe("gate");
	});

	it("matches names case-insensitively, anywhere in the name", () => {
		const gate = filter("GATE");
		expect(gate.matches(1, "Old gate")).toBe(true);
		expect(gate.matches(2, "Gatekeeper")).toBe(true);
		expect(gate.matches(3, "Door")).toBe(false);
		expect(filter("ü").matches(1, "BÜCHER")).toBe(true);
	});

	it("matches ids, written as 12 or #12", () => {
		expect(filter("12").matches(12, "Door")).toBe(true);
		expect(filter("#12").matches(12, "Door")).toBe(true);
		expect(filter("12").matches(1, "Door")).toBe(false);
		expect(filter("#12").matches(112, "Door")).toBe(false);
		// The text can still match names.
		expect(filter("12").matches(1, "Room 12")).toBe(true);
		expect(filter("#12").matches(1, "Locker #12")).toBe(true);
		expect(filter("1 2").matches(12, "Door")).toBe(false);
	});

	it("shows maps with matching events, and the maps they're listed under", () => {
		expect(mapsToShow("king")).toEqual([1, 2, 3]);
		expect(mapsToShow("chest")).toEqual([4]);
		expect(mapsToShow("#3")).toEqual([1, 2, 3]);
		expect(mapsToShow("#1")).toEqual([1, 2, 3, 4]);
		expect(mapsToShow("dragon")).toEqual([]);
	});

	it("shows maps whose name matches, and the maps they're listed under", () => {
		expect(mapsToShow("castle")).toEqual([1, 2]);
		expect(mapsToShow("room")).toEqual([1, 2, 3]);
		// A map whose parent isn't listed is at the top level.
		expect(mapsToShow("lost")).toEqual([5]);
		// Map ids don't match: only containers match by id.
		expect(mapsToShow("#2")).toEqual([4]);
	});

	it("only finds events on loaded maps", () => {
		const overworld = { 1: [null, mapEvent(1, "Hermit")] };
		const hermit = filter("hermit");
		expect([...hermit.mapsToShow(INFOS, (mapId) => EVENTS[mapId])]).toEqual([]);
		expect([...hermit.mapsToShow(INFOS, (mapId) => ({ ...EVENTS, ...overworld })[mapId])]).toEqual([
			1,
		]);
	});

	it("stops at maps listed under each other", () => {
		const looped = [null, mapInfo(1, "A", 2), mapInfo(2, "B", 1)];
		expect([...filter("a").mapsToShow(looped, () => undefined)].sort()).toEqual([1, 2]);
		expect(listedParentId(looped, looped[1]!)).toBe(2);
		expect(listedParentId(INFOS, INFOS[5]!)).toBe(0);
	});

	it("shows all of a matching map's events, or else the matching ones", () => {
		const events = EVENTS[3]!.flatMap((event, id) => (event ? [{ id, event }] : []));
		const shown = (text: string, info: MapInfo) =>
			events.filter(({ id, event }) => filter(text).eventsToShow(info)(id, event));
		expect(shown("throne", INFOS[3]!).map(({ event }) => event.name)).toEqual(["King", "Guard"]);
		expect(shown("guard", INFOS[3]!).map(({ event }) => event.name)).toEqual(["Guard"]);
		expect(shown("#1", INFOS[3]!).map(({ event }) => event.name)).toEqual(["King"]);
	});
});

describe("loadMaps", () => {
	it("loads every map that isn't loaded, reporting progress", async () => {
		const project = await fixture();
		await project.map(1);
		const progress: [number, number][] = [];
		await loadMaps([project], { onProgress: (done, total) => progress.push([done, total]) });
		// Map004.json is missing: it fails to load, and still counts.
		expect(progress).toEqual([
			[1, 4],
			[2, 4],
			[3, 4],
			[4, 4],
		]);
		expect(project.mapIds().filter((mapId) => !project.isMapLoaded(mapId))).toEqual([4]);
	});

	it("stops once aborted", async () => {
		const project = await fixture();
		const controller = new AbortController();
		controller.abort();
		const progress: number[] = [];
		await loadMaps([project], {
			signal: controller.signal,
			onProgress: (done) => progress.push(done),
		});
		expect(progress).toEqual([]);
		expect(project.mapIds().some((mapId) => project.isMapLoaded(mapId))).toBe(false);
	});
});

describe("ExplorerTree with a filter", () => {
	async function filteredTree(text: string, options: { loadMaps?: boolean } = {}) {
		const project = await fixture();
		if (options.loadMaps !== false) {
			await loadMaps([project]);
		}
		const folder = { name: "explorer", path: FIXTURE };
		const tree = new ExplorerTree(
			{ projects: [{ key: "explorer", folder, project }], whenLoaded: async () => {} },
			{ showEmptyEntries: false, filter: filter(text) },
		);
		return { tree, project };
	}

	it("shows only matching containers and the nodes they're under", async () => {
		const { tree } = await filteredTree("gate");
		expect(await outline(tree)).toEqual([
			"Maps | 1",
			"  1 · World",
			"    1 · Old gate | (12, 7)",
			"      Page 1 | action · switches.Door_open",
			"      Page 2 | playerTouch · variables.Day >= 3 · event.selfSwitches.A",
		]);
	});

	it("matches ids in every category, with or without #", async () => {
		const { tree } = await filteredTree("#3");
		const expected = [
			"Common Events | 1",
			"  3",
			"Maps | 1",
			"  1 · World",
			"    3 | (0, 4)",
			"      Page 1 | action",
			"Troops | 1",
			"  3",
			"    Page 1 | battle",
			"    Page 2 | moment",
		];
		expect(await outline(tree)).toEqual(expected);
		expect(await outline((await filteredTree("3")).tree)).toEqual(expected);
	});

	it("shows all the events of a map whose name matches, and finds nested maps", async () => {
		const { tree } = await filteredTree("inn");
		expect(await outline(tree, 3)).toEqual([
			"Maps | 2",
			"  1 · World",
			"    3 · Inn",
			"      1 · Innkeeper | (2, 3)",
		]);
		const world = await outline((await filteredTree("world")).tree, 2);
		expect(world).toEqual([
			"Maps | 1",
			"  1 · World",
			"    1 · Old gate | (12, 7)",
			"    3 | (0, 4)",
		]);
	});

	it("finds events only on loaded maps", async () => {
		const { tree, project } = await filteredTree("innkeeper", { loadMaps: false });
		expect(await tree.children()).toEqual([]);
		await project.map(3);
		expect(await outline(tree, 3)).toEqual([
			"Maps | 2",
			"  1 · World",
			"    3 · Inn",
			"      1 · Innkeeper | (2, 3)",
		]);
	});

	it("shows nothing when nothing matches, and everything once the filter is cleared", async () => {
		const { tree } = await filteredTree("dragon");
		expect(await tree.children()).toEqual([]);
		tree.options.filter = undefined;
		expect((await tree.children()).map((node) => node.label)).toEqual([
			"Common Events",
			"Maps",
			"Troops",
		]);
	});

	it("leaves out projects with no matches", async () => {
		const projects = await Promise.all(
			["basic", "explorer"].map(async (key) => {
				const project = await fixture(key);
				await loadMaps([project]);
				return { key, folder: { name: key, path: project.location.gameDir }, project };
			}),
		);
		const tree = new ExplorerTree(
			{ projects, whenLoaded: async () => {} },
			{ showEmptyEntries: false, filter: filter("rain sounds") },
		);
		expect(await outline(tree, 2)).toEqual([
			"Explorer Fixture | explorer",
			"  Common Events | 1",
			"    1 · Rain sounds | parallel · switches.Storm",
		]);
	});
});

async function fixture(name = "explorer"): Promise<MvProject> {
	const gameDir = join(FIXTURE, "..", name);
	return loadProject({ gameDir, dataDir: join(gameDir, "data"), layout: "flat" });
}

/** The tree down to `depth` levels below the top, indented, as `label | description`. */
async function outline(tree: ExplorerTree, depth = Infinity, node?: ExplorerNode, indent = "") {
	const lines: string[] = [];
	for (const each of await tree.children(node)) {
		lines.push(
			indent +
				(each.description === undefined ? each.label : `${each.label} | ${each.description}`),
		);
		if (depth > 0) {
			lines.push(...(await outline(tree, depth - 1, each, `${indent}  `)));
		}
	}
	return lines;
}
