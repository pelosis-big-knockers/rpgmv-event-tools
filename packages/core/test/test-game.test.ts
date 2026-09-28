import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { describeWithGame } from "./support/test-game.js";

describeWithGame("configured test game", (game) => {
	it("loads switch and variable names from System.json", async () => {
		const system = JSON.parse(await readFile(join(game.dataDir, "System.json"), "utf8")) as {
			switches: unknown;
			variables: unknown;
		};

		for (const names of [system.switches, system.variables]) {
			expect(Array.isArray(names)).toBe(true);
			const list = names as unknown[];
			// Index 0 is an unused placeholder; ids start at 1.
			expect(list[0]).toBe("");
			expect(list.length).toBeGreaterThan(1);
			expect(list.every((name) => typeof name === "string")).toBe(true);
		}
	});
});
