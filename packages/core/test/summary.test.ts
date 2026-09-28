import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findProjects, loadProject, resolveMvProject, summarizeProject } from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

describe("summarizeProject", () => {
	it("counts the basic fixture", async () => {
		const location = await resolveMvProject(
			fileURLToPath(new URL("./fixtures/basic", import.meta.url)),
		);
		expect(location).toBeDefined();
		const project = await loadProject(location!);
		expect(summarizeProject(project)).toEqual({
			title: "Fixture Game",
			commonEvents: 3,
			maps: 1,
			switches: 3,
			variables: 2,
		});
		expect(project.isMapLoaded(1)).toBe(false);
	});
});

describeWithGame("summary of the configured test game", (game) => {
	it("has common events, maps, switches and variables", async () => {
		const summary = summarizeProject(await loadProject(game));
		expect(summary.commonEvents).toBeGreaterThan(0);
		expect(summary.maps).toBeGreaterThan(0);
		expect(summary.switches).toBeGreaterThan(0);
		expect(summary.variables).toBeGreaterThan(0);
	});

	it("is found by searching from the folder above the game", async () => {
		const parent = join(game.gameDir, game.layout === "www" ? "../.." : "..");
		const projects = await findProjects(parent);
		expect(projects.map((project) => project.dataDir)).toContain(game.dataDir);
	});
});
