import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContainerRef } from "@rpgmv-event-tools/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHANGE_DELAY_MS,
	ChangeBatcher,
	affectsDocument,
	nodesToRefresh,
	reloadChangedFiles,
	type ChangeLog,
	type DataChange,
} from "../src/data-changes.js";
import { ExplorerTree, type ExplorerNode } from "../src/explorer-tree.js";
import { ProjectSession, type SessionProject } from "../src/project-session.js";
import { ScriptDocuments } from "../src/script-documents.js";

const FIXTURES = fileURLToPath(new URL("../../core/test/fixtures", import.meta.url));

describe("ChangeBatcher", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hands over the paths together once changes stop for a while", async () => {
		const batches: string[][] = [];
		const batcher = new ChangeBatcher((paths) => {
			batches.push(paths);
		});
		batcher.add("a");
		await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS - 1);
		batcher.add("b");
		batcher.add("a");
		await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS - 1);
		expect(batches).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(batches).toEqual([["a", "b"]]);

		batcher.add("c");
		await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS);
		expect(batches).toEqual([["a", "b"], ["c"]]);
	});

	it("handles one batch at a time, and goes on after one fails", async () => {
		const events: string[] = [];
		const errors: unknown[] = [];
		let release = () => {};
		const batcher = new ChangeBatcher(
			async (paths) => {
				events.push(`start ${paths.join()}`);
				if (paths.includes("slow")) {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				}
				if (paths.includes("bad")) {
					throw new Error("bad batch");
				}
				events.push(`end ${paths.join()}`);
			},
			{ delayMs: 10, onError: (error) => errors.push(error) },
		);
		batcher.add("slow");
		await vi.advanceTimersByTimeAsync(10);
		batcher.add("bad");
		await vi.advanceTimersByTimeAsync(10);
		batcher.add("last");
		const done = batcher.flush();
		expect(events).toEqual(["start slow"]);
		release();
		await done;
		expect(events).toEqual(["start slow", "end slow", "start bad", "start last", "end last"]);
		expect(errors).toEqual([new Error("bad batch")]);
	});

	it("drops waiting paths when disposed", async () => {
		const handle = vi.fn();
		const batcher = new ChangeBatcher(handle);
		batcher.add("a");
		batcher.dispose();
		await vi.advanceTimersByTimeAsync(CHANGE_DELAY_MS * 2);
		await batcher.flush();
		expect(handle).not.toHaveBeenCalled();
	});
});

/** A log that keeps its messages. */
function recordingLog(): ChangeLog & { warnings: string[] } {
	const warnings: string[] = [];
	return {
		warnings,
		info: () => {},
		warn: (message, error) => warnings.push(`${message} ${String(error)}`),
	};
}

describe("reloading changed data files", () => {
	let folder: string;
	let dataDir: string;
	let session: ProjectSession;
	let project: SessionProject;

	beforeEach(async () => {
		// The temporary folder holds a copy of the explorer fixture named like the original.
		const temp = await mkdtemp(join(tmpdir(), "rpgmv-changes-"));
		folder = join(temp, "explorer");
		dataDir = join(folder, "data");
		await cp(join(FIXTURES, "explorer"), folder, { recursive: true });
		session = new ProjectSession({ info: () => {}, error: () => {} });
		await session.addFolder({ name: "explorer", path: folder });
		project = session.projects[0]!;
	});

	afterEach(async () => {
		await rm(join(folder, ".."), { recursive: true, force: true });
	});

	/** Changes a data file of the copy in place. */
	async function edit(file: string, change: (data: any) => void): Promise<void> {
		const path = join(dataDir, file);
		const data = JSON.parse(await readFile(path, "utf8"));
		change(data);
		await writeFile(path, JSON.stringify(data));
	}

	function reload(...files: string[]): Promise<DataChange[]> {
		return reloadChangedFiles(
			session.projects,
			files.map((file) => join(dataDir, file)),
			recordingLog(),
		);
	}

	it("reloads names files, which change the whole project", async () => {
		await edit("CommonEvents.json", (events) => {
			events[1].name = "Thunder";
		});
		await edit("System.json", (system) => {
			system.switches[2] = "Storm";
		});
		const changes = await reload("CommonEvents.json", "System.json");
		expect(changes).toEqual([{ project, names: true, mapIds: new Set() }]);
		expect(project.project.commonEvents[1]?.name).toBe("Thunder");
		expect(project.project.symbols.format("switch", 2)).toContain("Storm");
	});

	it("reloads a loaded map, and leaves an unloaded map unloaded", async () => {
		await project.project.map(1);
		await edit("Map001.json", (map) => {
			map.events[1].name = "New gate";
		});
		await edit("Map002.json", (map) => {
			map.displayName = "Changed";
		});
		const changes = await reload("Map001.json", "Map002.json");
		expect(changes).toEqual([{ project, names: false, mapIds: new Set([1, 2]) }]);
		expect((await project.project.map(1)).events[1]?.name).toBe("New gate");
		expect(project.project.isMapLoaded(2)).toBe(false);
	});

	it("ignores files outside the data folder and files projects don't load", async () => {
		await writeFile(join(dataDir, "Notes.json"), "[]");
		const changes = await reloadChangedFiles(
			session.projects,
			[
				join(dataDir, "Notes.json"),
				join(folder, "System.json"),
				join(dataDir, "sub", "Map001.json"),
			],
			recordingLog(),
		);
		expect(changes).toEqual([]);
	});

	it("keeps the last good data of a file that fails to load, and retries it next time", async () => {
		await writeFile(join(dataDir, "CommonEvents.json"), "[null,{");
		const log = recordingLog();
		const changes = await reloadChangedFiles(
			session.projects,
			[join(dataDir, "CommonEvents.json")],
			log,
		);
		expect(changes).toEqual([]);
		expect(log.warnings).toHaveLength(1);
		expect(log.warnings[0]).toMatch(/^Could not reload CommonEvents\.json of rpgmv:\/explorer;/);
		expect(project.project.commonEvents[1]?.name).toBe("Rain sounds");

		await cp(
			join(FIXTURES, "explorer", "data", "CommonEvents.json"),
			join(dataDir, "CommonEvents.json"),
		);
		await edit("CommonEvents.json", (events) => {
			events[1].name = "Thunder";
		});
		expect(await reload("CommonEvents.json")).toEqual([
			{ project, names: true, mapIds: new Set() },
		]);
		expect(project.project.commonEvents[1]?.name).toBe("Thunder");
	});

	it("unloads a deleted map", async () => {
		await project.project.map(1);
		await rm(join(dataDir, "Map001.json"));
		expect(await reload("Map001.json")).toEqual([{ project, names: false, mapIds: new Set([1]) }]);
		expect(project.project.isMapLoaded(1)).toBe(false);
	});

	it("updates documents, and shows a comment for a removed container", async () => {
		const documents = new ScriptDocuments(session);
		const address = {
			projectKey: "explorer",
			container: { kind: "commonEvent", commonEventId: 1 },
		} as const;
		expect((await documents.get(address)).text).toContain('name: "Rain sounds"');

		await edit("CommonEvents.json", (events) => {
			events[1].name = "Thunder";
		});
		const [change] = await reload("CommonEvents.json");
		documents.forgetWhere((each) => affectsDocument(change!, each));
		expect((await documents.get(address)).text).toContain('name: "Thunder"');

		await edit("CommonEvents.json", (events) => {
			events[1] = null;
		});
		const [removal] = await reload("CommonEvents.json");
		documents.forgetWhere((each) => affectsDocument(removal!, each));
		expect((await documents.get(address)).text).toBe(
			`// Common event 1 doesn't exist in "explorer". It may have been deleted.\n`,
		);
	});
});

describe("affectsDocument", () => {
	const project = { key: "game" } as SessionProject;
	const commonEvent: ContainerRef = { kind: "commonEvent", commonEventId: 1 };
	const onMap = (mapId: number): ContainerRef => ({ kind: "mapEvent", mapId, eventId: 1 });

	it("picks every document of the project when names change", () => {
		const change: DataChange = { project, names: true, mapIds: new Set() };
		expect(affectsDocument(change, { projectKey: "game", container: commonEvent })).toBe(true);
		expect(affectsDocument(change, { projectKey: "game", container: onMap(4) })).toBe(true);
		expect(affectsDocument(change, { projectKey: "other", container: commonEvent })).toBe(false);
	});

	it("picks the events of changed maps", () => {
		const change: DataChange = { project, names: false, mapIds: new Set([2]) };
		expect(affectsDocument(change, { projectKey: "game", container: onMap(2) })).toBe(true);
		expect(affectsDocument(change, { projectKey: "game", container: onMap(3) })).toBe(false);
		expect(affectsDocument(change, { projectKey: "game", container: commonEvent })).toBe(false);
		expect(affectsDocument(change, { projectKey: "other", container: onMap(2) })).toBe(false);
	});
});

describe("nodesToRefresh", () => {
	async function source(...names: string[]) {
		const session = new ProjectSession({ info: () => {}, error: () => {} });
		await Promise.all(names.map((name) => session.addFolder({ name, path: join(FIXTURES, name) })));
		return session;
	}

	/** Every node of the tree, expanding everything but pages. */
	async function everyNode(tree: ExplorerTree): Promise<ExplorerNode[]> {
		const nodes: ExplorerNode[] = [];
		const visit = async (node?: ExplorerNode) => {
			for (const child of await tree.children(node)) {
				nodes.push(child);
				if (child.kind !== "container") {
					await visit(child);
				}
			}
		};
		await visit();
		return nodes;
	}

	it("rebuilds the whole tree when one project's names change", async () => {
		const session = await source("explorer");
		const nodes = await everyNode(new ExplorerTree(session));
		const change: DataChange = { project: session.projects[0]!, names: true, mapIds: new Set() };
		expect(nodesToRefresh(change, nodes)).toEqual([undefined]);
	});

	it("rebuilds the project's node when there are several", async () => {
		const session = await source("basic", "explorer");
		const nodes = await everyNode(new ExplorerTree(session));
		const explorer = session.projects.find((each) => each.key === "explorer")!;
		const refreshed = nodesToRefresh({ project: explorer, names: true, mapIds: new Set() }, nodes);
		expect(refreshed.map((node) => node?.id)).toEqual(["project:explorer"]);
	});

	it("rebuilds the nodes of changed maps that were shown", async () => {
		const session = await source("basic", "explorer");
		const nodes = await everyNode(new ExplorerTree(session));
		const explorer = session.projects.find((each) => each.key === "explorer")!;
		const change: DataChange = { project: explorer, names: false, mapIds: new Set([1, 3, 99]) };
		expect(nodesToRefresh(change, nodes).map((node) => node?.id)).toEqual([
			"map:explorer/maps/1",
			"map:explorer/maps/3",
		]);
		const shownTopLevel = nodes.filter((node) => node.kind !== "map");
		expect(nodesToRefresh(change, shownTopLevel)).toEqual([]);
	});
});
