import { describe, expect, it } from "vitest";
import {
	createNames,
	createSymbols,
	decompileDocument,
	summarizePage,
	type DecompileContext,
	type EventCommand,
	type EventPage,
	type EventPageConditions,
	type MapEvent,
	type TroopPage,
	type TroopPageConditions,
} from "../src/index.js";

const context: DecompileContext = {
	symbols: createSymbols(
		createNames(
			{ switches: ["", "Door_open", "Lantern lit"], variables: ["", "Day"] },
			{ item: [null, { name: "Lantern" }], actor: [null, { name: "Mira" }] },
		),
	),
};

const END: EventCommand = { code: 0, indent: 0, parameters: [] };

const NO_MAP_CONDITIONS: EventPageConditions = {
	switch1Valid: false,
	switch1Id: 1,
	switch2Valid: false,
	switch2Id: 1,
	variableValid: false,
	variableId: 1,
	variableValue: 0,
	selfSwitchValid: false,
	selfSwitchCh: "A",
	itemValid: false,
	itemId: 1,
	actorValid: false,
	actorId: 1,
};

const NO_TROOP_CONDITIONS: TroopPageConditions = {
	turnEnding: false,
	turnValid: false,
	turnA: 0,
	turnB: 0,
	enemyValid: false,
	enemyIndex: 0,
	enemyHp: 50,
	actorValid: false,
	actorId: 1,
	actorHp: 50,
	switchValid: false,
	switchId: 1,
};

function mapPage(conditions: Partial<EventPageConditions>, trigger = 0, list = [END]): EventPage {
	return { conditions: { ...NO_MAP_CONDITIONS, ...conditions }, trigger, list } as EventPage;
}

function troopPage(conditions: Partial<TroopPageConditions>, span = 0, list = [END]): TroopPage {
	return { conditions: { ...NO_TROOP_CONDITIONS, ...conditions }, span, list };
}

describe("summarizePage", () => {
	it("summarizes a map page's trigger and conditions with the script's names", () => {
		expect(summarizePage({ kind: "mapEvent", page: mapPage({}) }, context)).toEqual({
			options: '{ trigger: "action" }',
			summary: "action",
		});
		expect(
			summarizePage(
				{ kind: "mapEvent", page: mapPage({ switch1Valid: true, switch1Id: 1 }) },
				context,
			),
		).toEqual({
			options: '{ trigger: "action", when: () => switches.Door_open }',
			summary: "action · switches.Door_open",
		});
		const page = mapPage(
			{
				switch1Valid: true,
				switch1Id: 2,
				variableValid: true,
				variableValue: 3,
				selfSwitchValid: true,
			},
			1,
		);
		expect(summarizePage({ kind: "mapEvent", page }, context).summary).toBe(
			'playerTouch · switches["Lantern lit"] · variables.Day >= 3 · event.selfSwitches.A',
		);
	});

	it("summarizes a troop page's span and conditions", () => {
		const page = troopPage({ turnValid: true, turnA: 2 }, 1);
		expect(summarizePage({ kind: "troop", page }, context)).toEqual({
			options: '{ span: "turn", when: () => troop.turn(2) }',
			summary: "turn · troop.turn(2)",
		});
	});

	it("prints the options as the page's `page(…)` call does", () => {
		const pages = [
			mapPage({}, 4, []),
			mapPage({
				switch1Valid: true,
				switch1Id: 2,
				switch2Valid: true,
				switch2Id: 1,
				variableValid: true,
				variableValue: 3,
				itemValid: true,
				actorValid: true,
			}),
		];
		const event = { id: 1, name: "Gate", note: "", x: 0, y: 0, pages } as MapEvent;
		const { text } = decompileDocument([{ kind: "mapEvent", mapId: 1, id: 1, event }], context);
		const first = summarizePage({ kind: "mapEvent", page: pages[0]! }, context);
		expect(first.options).toBe('{ trigger: "parallel", end: false }');
		expect(text).toContain(`page(${first.options}, () => {})`);
		// Long options break over lines, as they do in the script, one level less indented.
		const second = summarizePage({ kind: "mapEvent", page: pages[1]! }, context);
		expect(second.options.split("\n")).toEqual([
			"{",
			'\ttrigger: "action",',
			"\twhen: () =>",
			'\t\tswitches["Lantern lit"] &&',
			"\t\tswitches.Door_open &&",
			"\t\tvariables.Day >= 3 &&",
			"\t\tparty.has(items.Lantern) &&",
			"\t\tparty.has(actors.Mira),",
			"}",
		]);
		const indented = second.options.replaceAll("\n", "\n\t\t");
		expect(text).toContain(`\tpage(\n\t\t${indented},\n\t\t() => {},\n\t),`);
	});

	it("shows conditions `when` can't express, and triggers without a name, as stored", () => {
		const summary = summarizePage(
			{ kind: "mapEvent", page: mapPage({ selfSwitchValid: true, selfSwitchCh: "E" }, 7) },
			context,
		);
		expect(summary.summary).toBe("7 · conditions");
		expect(summary.options).toMatch(/^\{\n\ttrigger: 7,\n\tconditions: \{\n/);
	});
});
