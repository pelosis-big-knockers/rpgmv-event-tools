import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATABASE_FILES, createNames, loadNames, type DatabaseKind } from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

const fixtureData = fileURLToPath(new URL("./fixtures/basic/data", import.meta.url));

describe("createNames", () => {
	const names = createNames(
		{ switches: ["", "Door unlocked", ""], variables: ["", "Gold"], equipTypes: ["", "Weapon"] },
		{
			item: [null, { id: 1, name: "Potion" }, { id: 2, name: "" }, null, { id: 4, name: "Ether" }],
			commonEvent: [null, { id: 1, name: "Toggle lantern" }],
		},
	);

	it("looks up switches, variables and System name lists", () => {
		expect(names.switch(1)).toBe("Door unlocked");
		expect(names.variable(1)).toBe("Gold");
		expect(names.of("equipType", 1)).toBe("Weapon");
	});

	it("looks up database entries by id", () => {
		expect(names.of("item", 1)).toBe("Potion");
		expect(names.of("item", 4)).toBe("Ether");
		expect(names.commonEvent(1)).toBe("Toggle lantern");
	});

	it("returns undefined for empty names, null entries, and ids out of range", () => {
		expect(names.switch(2)).toBeUndefined(); // empty name
		expect(names.of("item", 2)).toBeUndefined(); // empty name
		expect(names.of("item", 3)).toBeUndefined(); // null entry
		expect(names.of("item", 5)).toBeUndefined(); // past the end
		expect(names.of("item", 0)).toBeUndefined(); // slot 0 is never used
		expect(names.of("item", -1)).toBeUndefined();
		expect(names.of("item", 1.5)).toBeUndefined();
	});

	it("gives empty tables for kinds with no data", () => {
		expect(names.of("actor", 1)).toBeUndefined();
		expect(names.count("actor")).toBe(0);
		expect(createNames(undefined).switch(1)).toBeUndefined();
	});

	it("counts slots, named or not", () => {
		expect(names.count("switch")).toBe(2);
		expect(names.count("item")).toBe(4);
	});
});

describe("loadNames", () => {
	it("reads names from the basic fixture", async () => {
		const names = await loadNames(fixtureData);
		expect(names.switch(2)).toBe("Lantern lit");
		expect(names.variable(2)).toBe("Visits");
		expect(names.of("element", 1)).toBe("Fire");
		expect(names.of("actor", 2)).toBe("Traveller");
		expect(names.of("actor", 3)).toBeUndefined(); // unused slot
		expect(names.of("item", 3)).toBe("Rusty Key");
		expect(names.commonEvent(3)).toBe("Count visit");
		expect(names.of("map", 1)).toBe("Keeper's House");
	});

	it("treats database files missing from the fixture as empty", async () => {
		const names = await loadNames(fixtureData);
		expect(names.count("weapon")).toBe(0);
		expect(names.of("weapon", 1)).toBeUndefined();
	});

	it("requires System.json", async () => {
		await expect(loadNames(fileURLToPath(new URL("./fixtures", import.meta.url)))).rejects.toThrow(
			/System\.json/,
		);
	});
});

describeWithGame("names in the configured test game", (game) => {
	it("resolves names from System.json and every database file", async () => {
		const names = await loadNames(game.dataDir);
		expect(names.count("switch")).toBeGreaterThan(0);
		expect(names.count("variable")).toBeGreaterThan(0);

		const unnamed = (Object.keys(DATABASE_FILES) as DatabaseKind[]).filter((kind) => {
			const ids = Array.from({ length: names.count(kind) }, (_, i) => i + 1);
			return !ids.some((id) => names.of(kind, id) !== undefined);
		});
		expect(unnamed).toEqual([]);
	});
});
