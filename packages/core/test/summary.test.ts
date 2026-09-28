import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findProjects, readProjectSummary, resolveMvProject } from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

describe("readProjectSummary", () => {
	it("counts the basic fixture", async () => {
		const project = await resolveMvProject(
			fileURLToPath(new URL("./fixtures/basic", import.meta.url)),
		);
		expect(project).toBeDefined();
		expect(await readProjectSummary(project!)).toEqual({
			title: "Fixture Game",
			commonEvents: 3,
			maps: 1,
			switches: 3,
			variables: 2,
		});
	});

	it("reports which file is invalid", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "rpgmv-summary-"));
		try {
			writeFileSync(join(dataDir, "System.json"), '{"switches":[""],"variables":[""]}');
			writeFileSync(join(dataDir, "CommonEvents.json"), "[null,");
			writeFileSync(join(dataDir, "MapInfos.json"), "[null]");
			await expect(
				readProjectSummary({ gameDir: join(dataDir, ".."), dataDir, layout: "flat" }),
			).rejects.toThrow(/CommonEvents\.json is not valid JSON/);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});
});

describeWithGame("summary of the configured test game", (game) => {
	it("has common events, maps, switches and variables", async () => {
		const summary = await readProjectSummary(game);
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
