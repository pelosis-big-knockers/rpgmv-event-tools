import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "../src/index.js";

function readFixture(path: string): unknown {
	const url = new URL(`./fixtures/${path}`, import.meta.url);
	return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

interface FixtureCommonEvent {
	id: number;
	name: string;
	list: { code: number; indent: number; parameters: unknown[] }[];
}

describe("basic fixture", () => {
	it("exposes the core package", () => {
		expect(CORE_VERSION).toBe("0.0.0");
	});

	it("has named switches and variables, with an empty slot at index 0", () => {
		const system = readFixture("basic/data/System.json") as {
			switches: string[];
			variables: string[];
		};
		expect(system.switches).toEqual(["", "Door unlocked", "Lantern lit", "Met the keeper"]);
		expect(system.variables).toEqual(["", "Gold found", "Visits"]);
	});

	it("has common events whose ids match their index and whose lists end with code 0", () => {
		const events = readFixture("basic/data/CommonEvents.json") as (FixtureCommonEvent | null)[];
		expect(events[0]).toBeNull();
		const present = events.slice(1) as FixtureCommonEvent[];
		expect(present.map((e) => e.name)).toEqual(["Toggle lantern", "Greet keeper", "Count visit"]);
		present.forEach((event, i) => {
			expect(event.id).toBe(i + 1);
			expect(event.list.at(-1)).toEqual({ code: 0, indent: 0, parameters: [] });
		});
	});
});
