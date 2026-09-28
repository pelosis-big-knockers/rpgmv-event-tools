import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	describeLocation,
	loadProject,
	mapFileName,
	stringifyMvJson,
	type MvProjectLocation,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

const fixtureData = fileURLToPath(new URL("./fixtures/basic/data", import.meta.url));

/** A project backed by a temporary copy of a data folder, so tests can change files. */
async function copyProject(dataDir: string): Promise<MvProjectLocation> {
	const gameDir = await mkdtemp(join(tmpdir(), "rpgmv-project-"));
	await cp(dataDir, join(gameDir, "data"), { recursive: true });
	return { gameDir, dataDir: join(gameDir, "data"), layout: "flat" };
}

describe("loadProject on the basic fixture", () => {
	const location: MvProjectLocation = {
		gameDir: join(fixtureData, ".."),
		dataDir: fixtureData,
		layout: "flat",
	};

	it("loads System.json and the database files up front", async () => {
		const project = await loadProject(location);
		expect(project.system.gameTitle).toBe("Fixture Game");
		expect(project.commonEvents[2]?.name).toBe("Greet keeper");
		expect(project.troops[1]?.name).toBe("Cellar Bats");
		expect(project.mapIds()).toEqual([1]);
		expect(project.database("actor")).toHaveLength(4);
		expect(project.database("weapon")).toBeUndefined(); // not in the fixture
		expect(project.loadedFiles()).toEqual([
			"Actors.json",
			"CommonEvents.json",
			"Items.json",
			"MapInfos.json",
			"System.json",
			"Troops.json",
		]);
	});

	it("builds names from what it loaded", async () => {
		const project = await loadProject(location);
		expect(project.names.switch(2)).toBe("Lantern lit");
		expect(project.names.of("actor", 1)).toBe("Keeper");
		expect(project.names.of("map", 1)).toBe("Keeper's House");
		expect(project.names.of("troop", 1)).toBe("Cellar Bats");
	});

	it("loads maps when first asked for, and only once", async () => {
		const project = await loadProject(location);
		expect(project.isMapLoaded(1)).toBe(false);

		const [first, second] = await Promise.all([project.map(1), project.map(1)]);
		expect(first).toBe(second);
		expect(first.events[1]?.name).toBe("Keeper");
		expect(project.isMapLoaded(1)).toBe(true);
		expect(await project.map(1)).toBe(first);
	});

	it("lists every command list, loading maps as needed", async () => {
		const project = await loadProject(location);
		const locations = [];
		for await (const { location: where } of project.commandLists()) {
			locations.push(describeLocation(where));
		}
		expect(locations).toEqual([
			"Common event 1",
			"Common event 2",
			"Common event 3",
			"Troop 1, page 1",
			"Troop 1, page 2",
			"Map 1, event 1, page 1",
			"Map 1, event 1, page 2",
		]);
		expect(project.isMapLoaded(1)).toBe(true);
	});

	it("rejects a map that isn't there, naming the file", async () => {
		const project = await loadProject(location);
		await expect(project.map(2)).rejects.toThrow(/Could not load Map002\.json/);
		// A failed load isn't cached, so a later attempt tries again.
		await expect(project.map(2)).rejects.toThrow(/Map002\.json/);
	});
});

describe("mapFileName", () => {
	it("pads map ids to three digits, as MV does", () => {
		expect(mapFileName(7)).toBe("Map007.json");
		expect(mapFileName(123)).toBe("Map123.json");
		expect(mapFileName(1234)).toBe("Map1234.json");
	});
});

describe("projects on disk", () => {
	let location: MvProjectLocation;

	beforeEach(async () => {
		location = await copyProject(fixtureData);
	});

	afterEach(async () => {
		await rm(location.gameDir, { recursive: true, force: true });
	});

	it("name the file when a required file is missing or invalid", async () => {
		await rm(join(location.dataDir, "Troops.json"));
		await expect(loadProject(location)).rejects.toThrow(/Could not load Troops\.json/);

		await writeFile(join(location.dataDir, "Troops.json"), "[null,");
		await expect(loadProject(location)).rejects.toThrow(/Could not load Troops\.json/);

		await writeFile(join(location.dataDir, "Troops.json"), "{}");
		await expect(loadProject(location)).rejects.toThrow(
			"Troops.json (top level): expected an array",
		);
	});

	it("save a changed file in the MV editor's layout", async () => {
		const project = await loadProject(location);
		project.commonEvents[1]!.name = "Toggle lamp";
		await project.save("CommonEvents.json");

		const saved = await readFile(join(location.dataDir, "CommonEvents.json"), "utf8");
		expect(saved).toBe(stringifyMvJson("CommonEvents.json", project.commonEvents));
		expect((await loadProject(location)).commonEvents[1]?.name).toBe("Toggle lamp");
	});

	it("save maps only once they're loaded", async () => {
		const project = await loadProject(location);
		await expect(project.save("Map001.json")).rejects.toThrow("Map001.json is not loaded");

		(await project.map(1)).events[1]!.name = "Gatekeeper";
		await project.save("Map001.json");
		expect((await (await loadProject(location)).map(1)).events[1]?.name).toBe("Gatekeeper");
	});

	it("reload a file that changed on disk", async () => {
		const project = await loadProject(location);
		expect(project.names.commonEvent(1)).toBe("Toggle lantern");

		const other = await loadProject(location);
		other.commonEvents[1]!.name = "Changed elsewhere";
		await other.save("CommonEvents.json");

		expect(project.commonEvents[1]?.name).toBe("Toggle lantern");
		await project.reload("CommonEvents.json");
		expect(project.commonEvents[1]?.name).toBe("Changed elsewhere");
		expect(project.names.commonEvent(1)).toBe("Changed elsewhere");
	});

	it("reload loaded maps, and leave unloaded maps to load later", async () => {
		const project = await loadProject(location);
		const other = await loadProject(location);
		(await other.map(1)).events[1]!.name = "Changed elsewhere";
		await other.save("Map001.json");

		await project.reload("Map001.json");
		expect(project.isMapLoaded(1)).toBe(false);
		expect((await project.map(1)).events[1]?.name).toBe("Changed elsewhere");

		(await other.map(1)).events[1]!.name = "Changed again";
		await other.save("Map001.json");
		await project.reload("Map001.json");
		expect(project.isMapLoaded(1)).toBe(true);
		expect((await project.map(1)).events[1]?.name).toBe("Changed again");
	});

	it("reload an optional database file that was added or removed", async () => {
		const project = await loadProject(location);
		await rm(join(location.dataDir, "Actors.json"));
		await project.reload("Actors.json");
		expect(project.database("actor")).toBeUndefined();
		expect(project.names.of("actor", 1)).toBeUndefined();
	});

	it("refuse to reload or save files the project doesn't know", async () => {
		const project = await loadProject(location);
		await expect(project.reload("Plugins.json")).rejects.toThrow(
			"Plugins.json is not a data file this project loads",
		);
		await expect(project.save("Plugins.json")).rejects.toThrow("Plugins.json is not loaded");
	});
});

describeWithGame("loadProject on the configured test game", (game) => {
	it("loads every map and saves every file byte for byte", { timeout: 60_000 }, async () => {
		const location = await copyProject(game.dataDir);
		try {
			const project = await loadProject(location);
			let lists = 0;
			for await (const _ of project.commandLists()) {
				lists++;
			}
			expect(lists).toBeGreaterThan(0);
			expect(project.mapIds().every((id) => project.isMapLoaded(id))).toBe(true);

			// Overwrite every loaded file, then compare with the untouched originals.
			for (const file of project.loadedFiles()) {
				await project.save(file);
			}
			const differing = [];
			for (const file of project.loadedFiles()) {
				const [original, saved] = await Promise.all([
					readFile(join(game.dataDir, file)),
					readFile(join(location.dataDir, file)),
				]);
				if (!original.equals(saved)) {
					differing.push(file);
				}
			}
			expect(differing).toEqual([]);

			// Every JSON file in the data folder is either loaded, or one the project doesn't use.
			const notLoaded = (await readdir(game.dataDir)).filter(
				(file) => file.endsWith(".json") && !project.loadedFiles().includes(file),
			);
			expect(notLoaded).toEqual([]);
		} finally {
			await rm(location.gameDir, { recursive: true, force: true });
		}
	});
});
