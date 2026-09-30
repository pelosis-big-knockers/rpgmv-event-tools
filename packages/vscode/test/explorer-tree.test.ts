import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, type MvProjectLocation } from "@rpgmv-event-tools/core";
import { describe, expect, it } from "vitest";
import { describeWithGame } from "../../core/test/support/test-game.js";
import {
	ExplorerTree,
	type ExplorerNode,
	type ExplorerOptions,
	type ExplorerSource,
} from "../src/explorer-tree.js";
import type { SessionProject } from "../src/project-session.js";
import { parseScriptPath } from "../src/script-uri.js";

const FIXTURES = fileURLToPath(new URL("../../core/test/fixtures", import.meta.url));

function location(gameDir: string): MvProjectLocation {
	return { gameDir, dataDir: join(gameDir, "data"), layout: "flat" };
}

/** A session with the named fixtures loaded, each keyed by its folder's name. */
async function source(...fixtures: string[]): Promise<ExplorerSource> {
	const projects: SessionProject[] = await Promise.all(
		fixtures.map(async (name) => {
			const path = join(FIXTURES, name);
			return {
				key: name,
				folder: { name, path },
				project: await loadProject(location(path)),
			};
		}),
	);
	return { projects, whenLoaded: async () => {} };
}

async function explorerTree(options?: ExplorerOptions): Promise<ExplorerTree> {
	return new ExplorerTree(await source("explorer"), options);
}

/** The labels and descriptions of nodes, as `label | description`. */
function show(nodes: readonly ExplorerNode[]): string[] {
	return nodes.map((node) =>
		node.description === undefined ? node.label : `${node.label} | ${node.description}`,
	);
}

/** The child of `node` (or of the top level) with `label`. */
async function child(tree: ExplorerTree, node: ExplorerNode | undefined, label: string) {
	const found = (await tree.children(node)).find((each) => each.label === label);
	if (!found) {
		expect.fail(`no child "${label}" under ${node?.label ?? "the top level"}`);
	}
	return found;
}

describe("ExplorerTree", () => {
	it("shows one project's categories at the top level", async () => {
		const tree = await explorerTree();
		const top = await tree.children();
		expect(show(top)).toEqual(["Common Events | 3", "Maps | 5", "Troops | 2"]);
		expect(top.every((node) => node.parent === undefined && node.collapsible)).toBe(true);
	});

	it("lists the projects at the top level when there are several", async () => {
		const tree = new ExplorerTree(await source("basic", "explorer"));
		const top = await tree.children();
		expect(show(top)).toEqual(["Fixture Game | basic", "Explorer Fixture | explorer"]);
		const categories = await tree.children(top[1]);
		expect(show(categories)).toEqual(["Common Events | 3", "Maps | 5", "Troops | 2"]);
		expect(categories[0]?.parent).toBe(top[1]);
	});

	it("shows nothing without projects, once they've loaded", async () => {
		let loaded = false;
		const tree = new ExplorerTree({
			projects: [],
			whenLoaded: async () => {
				loaded = true;
			},
		});
		expect(await tree.children()).toEqual([]);
		expect(loaded).toBe(true);
	});

	it("lists common events by id, hiding empty slots", async () => {
		const tree = await explorerTree();
		const events = await tree.children(await child(tree, undefined, "Common Events"));
		expect(show(events)).toEqual([
			"1 · Rain sounds | parallel · switches.Storm",
			"3",
			"4 · Unused",
		]);
		expect(events.map((node) => node.open)).toEqual([
			{ path: "/explorer/common-events/1/Rain sounds.mvscript" },
			{ path: "/explorer/common-events/3/Common event 3.mvscript" },
			{ path: "/explorer/common-events/4/Unused.mvscript" },
		]);
		expect(events.every((node) => !node.collapsible)).toBe(true);
	});

	it("shows empty slots with showEmptyEntries", async () => {
		const tree = await explorerTree({ showEmptyEntries: true });
		const [commonEvents, , troops] = await tree.children();
		expect(show([commonEvents!, troops!])).toEqual(["Common Events | 4", "Troops | 3"]);
		expect(show(await tree.children(commonEvents))).toContain("2");
		expect(show(await tree.children(troops))).toEqual(["1 · Bats", "2", "3"]);
		// The option can change after the tree is made.
		tree.options.showEmptyEntries = false;
		expect(show(await tree.children(troops))).toEqual(["1 · Bats", "3"]);
	});

	it("nests maps by parent and order, and lists child maps before events", async () => {
		const tree = await explorerTree();
		const maps = await child(tree, undefined, "Maps");
		const top = await tree.children(maps);
		// "Orphan"'s parent (9) isn't listed, so it's at the top level.
		expect(show(top)).toEqual(["4 · Lost map", "1 · World", "6 · Orphan"]);
		const world = top[1]!;
		const inWorld = await tree.children(world);
		expect(show(inWorld)).toEqual(["3 · Inn", "2 · Town", "1 · Old gate | (12, 7)", "3 | (0, 4)"]);
		expect(inWorld.map((node) => node.kind)).toEqual(["map", "map", "container", "container"]);
		expect(inWorld.every((node) => node.parent === world)).toBe(true);
		expect(inWorld[2]?.open).toEqual({ path: "/explorer/maps/1/events/1/Old gate.mvscript" });
		expect(show(await tree.children(inWorld[0]))).toEqual(["1 · Innkeeper | (2, 3)"]);
		expect(await tree.children(inWorld[1])).toEqual([]);
	});

	it("loads a map's file when the map is expanded", async () => {
		const tree = await explorerTree();
		const maps = await child(tree, undefined, "Maps");
		const world = await child(tree, maps, "1 · World");
		const { project } = maps.kind === "category" ? maps.project : expect.fail("not a category");
		expect(project.isMapLoaded(1)).toBe(false);
		await tree.children(world);
		expect(project.isMapLoaded(1)).toBe(true);
		expect(project.isMapLoaded(3)).toBe(false);
	});

	it("shows a map whose file can't be loaded with a message", async () => {
		const tree = await explorerTree();
		const lost = await child(tree, await child(tree, undefined, "Maps"), "4 · Lost map");
		const [message, ...rest] = await tree.children(lost);
		expect(rest).toEqual([]);
		expect(message).toMatchObject({
			kind: "message",
			label: "Couldn't load Map004.json",
			collapsible: false,
			parent: lost,
		});
		expect(message?.tooltip?.text).toMatch(/Could not load Map004\.json/);
		expect(await tree.children(message)).toEqual([]);
	});

	it("lists a map event's pages with their trigger and conditions", async () => {
		const tree = await explorerTree();
		const world = await child(tree, await child(tree, undefined, "Maps"), "1 · World");
		const gate = await child(tree, world, "1 · Old gate");
		const pages = await tree.children(gate);
		expect(show(pages)).toEqual([
			"Page 1 | action · switches.Door_open",
			"Page 2 | playerTouch · variables.Day >= 3 · event.selfSwitches.A",
		]);
		expect(pages.map((node) => node.open)).toEqual([
			{ path: "/explorer/maps/1/events/1/Old gate.mvscript", pageIndex: 0 },
			{ path: "/explorer/maps/1/events/1/Old gate.mvscript", pageIndex: 1 },
		]);
		expect(pages[0]?.tooltip).toEqual({
			text: "Page 1",
			code: '{ trigger: "action", when: () => switches.Door_open }',
		});
		expect(pages[1]?.tooltip?.code).toBe(
			'{ trigger: "playerTouch", when: (event) => variables.Day >= 3 && event.selfSwitches.A }',
		);
		expect(pages.every((node) => node.parent === gate && !node.collapsible)).toBe(true);
	});

	it("lists a troop's pages with their span and conditions", async () => {
		const tree = await explorerTree();
		const troops = await tree.children(await child(tree, undefined, "Troops"));
		expect(troops.every((node) => node.collapsible)).toBe(true);
		expect(troops[0]?.open).toEqual({ path: "/explorer/troops/1/Bats.mvscript" });
		expect(show(await tree.children(troops[0]))).toEqual([
			"Page 1 | turn · troop.turn(2)",
			"Page 2 | battle",
		]);
		const unnamed = await tree.children(troops[1]);
		expect(show(unnamed)).toEqual(["Page 1 | battle", "Page 2 | moment"]);
		expect(unnamed[1]?.tooltip?.code).toBe('{ span: "moment", end: false }');
	});

	it("gives each node an id that's unique and the same each time", async () => {
		const tree = new ExplorerTree(await source("basic", "explorer"), { showEmptyEntries: true });
		const ids = (await walk(tree)).map((node) => node.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect((await walk(tree)).map((node) => node.id)).toEqual(ids);
		expect(ids).toContain("page:explorer/maps/1/events/1/pages/1");
	});
});

/** Every node of the tree, depth first. */
async function walk(tree: ExplorerTree, node?: ExplorerNode): Promise<ExplorerNode[]> {
	const nodes: ExplorerNode[] = [];
	for (const each of await tree.children(node)) {
		nodes.push(each, ...(await walk(tree, each)));
	}
	return nodes;
}

describeWithGame("the explorer's tree for the configured test game", (game) => {
	it("builds the whole tree, reaching every container", { timeout: 300_000 }, async () => {
		const project = await loadProject(game);
		const key = basename(game.gameDir);
		const folder = { name: key, path: game.gameDir };
		const tree = new ExplorerTree(
			{ projects: [{ key, folder, project }], whenLoaded: async () => {} },
			{ showEmptyEntries: true },
		);
		const nodes = await walk(tree);
		const messages = nodes.filter((node) => node.kind === "message");
		expect(messages.map((node) => node.tooltip?.text)).toEqual([]);

		const opened = new Set(
			nodes.flatMap((node) => (node.open && node.kind === "container" ? [node.open.path] : [])),
		);
		let containers = 0;
		containers += project.commonEvents.filter(Boolean).length;
		containers += project.troops.filter(Boolean).length;
		for (const mapId of project.mapIds()) {
			containers += (await project.map(mapId)).events.filter(Boolean).length;
		}
		expect(opened.size).toBe(containers);
		for (const path of opened) {
			expect(parseScriptPath(path)?.projectKey, path).toBe(key);
		}
		const pages = nodes.filter((node) => node.kind === "page");
		expect(pages.every((node) => node.description && node.tooltip?.code)).toBe(true);
	});
});
