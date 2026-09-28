import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMvProject } from "../src/index.js";

describe("resolveMvProject", () => {
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
