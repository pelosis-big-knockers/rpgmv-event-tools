import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjects, resolveMvProject } from "../src/index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "rpgmv-project-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function touch(...segments: string[]): void {
	const path = join(root, ...segments);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, "{}");
}

describe("resolveMvProject", () => {
	describe("deployed desktop game (www/data)", () => {
		beforeEach(() => touch("www", "data", "System.json"));
		const expected = () => ({
			gameDir: join(root, "www"),
			dataDir: join(root, "www", "data"),
			layout: "www",
		});

		it("resolves from the game root", async () => {
			expect(await resolveMvProject(root)).toEqual(expected());
		});

		it("resolves from the www folder", async () => {
			expect(await resolveMvProject(join(root, "www"))).toEqual(expected());
		});

		it("resolves from the data folder", async () => {
			expect(await resolveMvProject(join(root, "www", "data"))).toEqual(expected());
		});
	});

	it("resolves an editor project folder", async () => {
		touch("data", "System.json");
		touch("Game.rpgproject");
		expect(await resolveMvProject(root)).toEqual({
			gameDir: root,
			dataDir: join(root, "data"),
			layout: "editor",
		});
	});

	it("resolves a flat layout with no project file", async () => {
		touch("data", "System.json");
		expect(await resolveMvProject(root)).toEqual({
			gameDir: root,
			dataDir: join(root, "data"),
			layout: "flat",
		});
	});

	it("resolves the committed basic fixture", async () => {
		const fixture = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
		expect(await resolveMvProject(fixture)).toMatchObject({ layout: "flat" });
	});

	it("returns undefined when there is no System.json", async () => {
		touch("data", "CommonEvents.json");
		expect(await resolveMvProject(root)).toBeUndefined();
	});

	it("returns undefined when System.json is a folder", async () => {
		mkdirSync(join(root, "data", "System.json"), { recursive: true });
		expect(await resolveMvProject(root)).toBeUndefined();
	});

	it("returns undefined for a path that does not exist", async () => {
		expect(await resolveMvProject(join(root, "missing"))).toBeUndefined();
	});
});

describe("findProjects", () => {
	const dataDirs = async (options?: { maxDepth: number }) =>
		(await findProjects(root, options)).map((project) => project.dataDir);

	it("finds the folder itself when it is a project", async () => {
		touch("www", "data", "System.json");
		expect(await findProjects(root)).toEqual([
			{ gameDir: join(root, "www"), dataDir: join(root, "www", "data"), layout: "www" },
		]);
	});

	it("finds several projects in nested folders, sorted by data folder", async () => {
		touch("games", "B Game", "www", "data", "System.json");
		touch("games", "A Game", "data", "System.json");
		touch("games", "A Game", "Game.rpgproject");
		expect(await findProjects(root)).toEqual([
			{
				gameDir: join(root, "games", "A Game"),
				dataDir: join(root, "games", "A Game", "data"),
				layout: "editor",
			},
			{
				gameDir: join(root, "games", "B Game", "www"),
				dataDir: join(root, "games", "B Game", "www", "data"),
				layout: "www",
			},
		]);
	});

	it("does not search inside a project it has found", async () => {
		touch("data", "System.json");
		touch("img", "backup", "data", "System.json");
		expect(await dataDirs()).toEqual([join(root, "data")]);
	});

	it("skips node_modules and .git", async () => {
		touch("node_modules", "pkg", "data", "System.json");
		touch(".git", "x", "data", "System.json");
		expect(await dataDirs()).toEqual([]);
	});

	it("stops at maxDepth", async () => {
		touch("a", "b", "data", "System.json");
		expect(await dataDirs({ maxDepth: 1 })).toEqual([]);
		expect(await dataDirs({ maxDepth: 2 })).toEqual([join(root, "a", "b", "data")]);
	});

	it("returns an empty list for a folder that does not exist", async () => {
		expect(await dataDirs()).toEqual([]);
		expect(await findProjects(join(root, "missing"))).toEqual([]);
	});
});
