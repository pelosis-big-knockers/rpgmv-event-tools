import { describe, expect, it } from "vitest";
import {
	createNames,
	createSymbols,
	decompileDocument,
	loadProject,
	RENDERERS,
	sumCoverage,
	type CommandRenderer,
	type DecompileContext,
	type DecompiledScript,
	type EventCommand,
	type ListLocation,
	type ScriptContainer,
} from "../src/index.js";
import { expectPrettierStable } from "./support/prettier.js";
import { describeWithGame } from "./support/test-game.js";

const named = (...names: string[]) => [null, ...names.map((name) => ({ name }))];

const context: DecompileContext = {
	symbols: createSymbols(
		createNames(
			{
				switches: ["", "Door_open", "Lantern lit"],
				variables: ["", "Day", "Knocks", "Price"],
			},
			{
				actor: named("Mira"),
				class: named("Knight"),
				skill: named("Heal"),
				item: named("Lantern"),
				weapon: named("Club"),
				armor: named("Cloak"),
				state: named("Poison"),
				commonEvent: named("Open chest"),
			},
		),
	),
};

const cmd = (code: number, indent: number, parameters: unknown[] = []): EventCommand => ({
	code,
	indent,
	parameters,
});
const END = cmd(0, 0);

function decompileList(list: EventCommand[]): DecompiledScript {
	const container: ScriptContainer = {
		kind: "commonEvent",
		id: 1,
		commonEvent: { id: 1, name: "Test", trigger: 0, switchId: 1, list: [...list, END] },
	};
	return decompileDocument([container], context);
}

/** The body of the printed common event, without its indentation. */
function body(script: DecompiledScript): string {
	return script.text
		.split("\n")
		.slice(3, -2)
		.map((line) => line.slice(1))
		.join("\n");
}

/** A Conditional Branch with an empty body. */
const ifOnly = (parameters: unknown[]) => [cmd(111, 0, parameters), cmd(0, 1), cmd(412, 0)];

describe("conditional branch", () => {
	it("prints every condition type", async () => {
		const cases: [unknown[], string][] = [
			[[0, 1, 0], "switches.Door_open"],
			[[0, 2, 1], '!switches["Lantern lit"]'],
			[[1, 1, 0, 5, 0], "variables.Day === 5"],
			[[1, 1, 0, -2, 1], "variables.Day >= -2"],
			[[1, 1, 1, 2, 2], "variables.Day <= variables.Knocks"],
			[[1, 1, 0, 5, 3], "variables.Day > 5"],
			[[1, 1, 0, 5, 4], "variables.Day < 5"],
			[[1, 1, 0, 5, 5], "variables.Day !== 5"],
			[[2, "B", 0], "event.selfSwitches.B"],
			[[2, "C", 1], "!event.selfSwitches.C"],
			[[3, 60, 0], "timer.seconds >= 60"],
			[[3, 60, 1], "timer.seconds <= 60"],
			[[4, 1, 0], "party.has(actors.Mira)"],
			[[4, 1, 1, "Mira"], 'actors.Mira.name === "Mira"'],
			[[4, 1, 2, 1], "actors.Mira.class === classes.Knight"],
			[[4, 1, 3, 1], "actors.Mira.hasSkill(skills.Heal)"],
			[[4, 1, 4, 1], "actors.Mira.hasWeapon(weapons.Club)"],
			[[4, 1, 5, 1], "actors.Mira.hasArmor(armors.Cloak)"],
			[[4, 1, 6, 1], "actors.Mira.hasState(states.Poison)"],
			[[5, 0, 0], "troop.members[0].appeared"],
			[[5, 2, 1, 1], "troop.members[2].hasState(states.Poison)"],
			[[6, -1, 8], 'player.direction === "up"'],
			[[6, 0, 2], 'event.direction === "down"'],
			[[6, 4, 4], 'map.events[4].direction === "left"'],
			[[7, 100, 0], "party.gold >= 100"],
			[[7, 100, 1], "party.gold <= 100"],
			[[7, 100, 2], "party.gold < 100"],
			[[8, 1], "party.has(items.Lantern)"],
			[[9, 1, false], "party.has(weapons.Club)"],
			[[9, 1, true], "party.has(weapons.Club, { includeEquipment: true })"],
			[[10, 1, true], "party.has(armors.Cloak, { includeEquipment: true })"],
			[[11, "ok"], 'input.isPressed("ok")'],
			[[12, "$gameParty.size() > 2"], "script(() => $gameParty.size() > 2)"],
			[[12, "Input.isPressed('up');"], `script("Input.isPressed('up');")`],
			[[13, 2], 'player.isRiding("airship")'],
		];
		const script = decompileList(cases.flatMap(([parameters]) => ifOnly(parameters)));
		expect(body(script)).toBe(cases.map(([, test]) => `if (${test}) {\n}`).join("\n"));
		expect(script.text).toContain("(event) => {");
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("keeps conditions it can't print exactly as raw commands", () => {
		const cases: unknown[][] = [
			[0, 1, 2],
			[0, 1, 0, "extra"],
			[1, 1, 2, 5, 0],
			[1, 1, 0, 5, 6],
			[2, "E", 0],
			[4, 1, 7, 1],
			[4, 1, 1, "two\nlines"],
			[6, -1, 5],
			[9, 1, 0],
			[11, "o\nk"],
			[12, "a\nb"],
			[13, 3],
			[14, 1],
		];
		const script = decompileList(cases.flatMap((parameters) => ifOnly(parameters)));
		expect(script.coverage.rawByCode.get(111)).toBe(cases.length);
		expect(script.text).not.toContain("if (");
	});

	it("prints else, else if chains and empty branches", async () => {
		const script = decompileList([
			cmd(111, 0, [0, 1, 0]),
			cmd(121, 1, [1, 1, 1]),
			cmd(0, 1),
			cmd(411, 0),
			cmd(111, 1, [1, 1, 0, 3, 1]),
			cmd(0, 2),
			cmd(411, 1),
			cmd(111, 2, [8, 1]),
			cmd(123, 3, ["A", 0]),
			cmd(0, 3),
			cmd(411, 2),
			cmd(0, 3),
			cmd(412, 2),
			cmd(0, 2),
			cmd(412, 1),
			cmd(0, 1),
			cmd(412, 0),
			// An else holding more than an if stays a plain else.
			cmd(111, 0, [0, 2, 0]),
			cmd(0, 1),
			cmd(411, 0),
			cmd(111, 1, [0, 1, 0]),
			cmd(0, 2),
			cmd(412, 1),
			cmd(115, 1),
			cmd(0, 1),
			cmd(412, 0),
		]);
		expect(body(script)).toBe(
			[
				"if (switches.Door_open) {",
				"\tswitches.Door_open = false;",
				"} else if (variables.Day >= 3) {",
				"} else if (party.has(items.Lantern)) {",
				"\tevent.selfSwitches.A = true;",
				"} else {",
				"}",
				'if (switches["Lantern lit"]) {',
				"} else {",
				"\tif (switches.Door_open) {",
				"\t}",
				"\texitEventProcessing();",
				"}",
			].join("\n"),
		);
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("maps the lines of an if to its commands", () => {
		const script = decompileList([
			cmd(111, 0, [0, 1, 0]),
			cmd(230, 1, [60]),
			cmd(0, 1),
			cmd(411, 0),
			cmd(0, 1),
			cmd(412, 0),
		]);
		const location: ListLocation = { kind: "commonEvent", commonEventId: 1 };
		const lineOf = (index: number) => script.sourceMap.linesOf(location, index);
		// Line 3 is `if (…) {`, 4 the body, 5 `} else {`, 6 the closing `}`.
		expect(lineOf(0)).toEqual({ startLine: 3, endLine: 6 });
		expect(lineOf(1)).toEqual({ startLine: 4, endLine: 4 });
		expect(lineOf(2)).toEqual({ startLine: 5, endLine: 5 });
		expect(lineOf(3)).toEqual({ startLine: 5, endLine: 5 });
		expect(lineOf(4)).toEqual({ startLine: 6, endLine: 6 });
		expect(lineOf(5)).toEqual({ startLine: 6, endLine: 6 });
	});
});

describe("loops and jumps", () => {
	it("prints loops, breaks, exits, labels and common event calls", async () => {
		const script = decompileList([
			cmd(118, 0, ["Start"]),
			cmd(112, 0),
			cmd(111, 1, [0, 1, 0]),
			cmd(113, 2),
			cmd(0, 2),
			cmd(412, 1),
			cmd(112, 1),
			cmd(113, 2),
			cmd(0, 2),
			cmd(413, 1),
			cmd(0, 1),
			cmd(413, 0),
			cmd(113, 0),
			cmd(119, 0, ["Start"]),
			cmd(117, 0, [1]),
			cmd(117, 0, [9]),
			cmd(115, 0),
		]);
		expect(body(script)).toBe(
			[
				'label("Start");',
				"loop((loop) => {",
				"\tif (switches.Door_open) {",
				"\t\tloop.break();",
				"\t}",
				"\tloop((loop) => {",
				"\t\tloop.break();",
				"\t});",
				"});",
				"breakLoop();",
				'jumpTo("Start");',
				'commonEvents["Open chest"]();',
				"commonEvents[9]();",
				"exitEventProcessing();",
			].join("\n"),
		);
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("keeps commands with unexpected parameters raw", () => {
		const script = decompileList([
			cmd(112, 0, [1]),
			cmd(0, 1),
			cmd(413, 0),
			cmd(113, 0, [1]),
			cmd(115, 0, [1]),
			cmd(118, 0, [1]),
			cmd(119, 0, ["a\nb"]),
			cmd(117, 0, [-1]),
		]);
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({
			0: 1,
			112: 1,
			113: 1,
			115: 1,
			117: 1,
			118: 1,
			119: 1,
			413: 1,
		});
	});
});

describe("game state", () => {
	it("prints switches, self switches and the timer", async () => {
		const script = decompileList([
			cmd(121, 0, [1, 1, 0]),
			cmd(121, 0, [2, 2, 1]),
			cmd(121, 0, [1, 5, 1]),
			cmd(123, 0, ["D", 1]),
			cmd(124, 0, [0, 90]),
			cmd(124, 0, [1, 0]),
		]);
		expect(body(script)).toBe(
			[
				"switches.Door_open = true;",
				'switches["Lantern lit"] = false;',
				"switches.range(1, 5).set(false);",
				"event.selfSwitches.D = false;",
				"timer.start(90);",
				"timer.stop();",
			].join("\n"),
		);
		await expectPrettierStable(script);
	});

	it("prints every variable operation and operand", async () => {
		const operand = (type: number, ...values: unknown[]) => cmd(122, 0, [1, 1, 0, type, ...values]);
		const script = decompileList([
			...[0, 1, 2, 3, 4, 5].map((operation) => cmd(122, 0, [1, 1, operation, 0, 7])),
			cmd(122, 0, [1, 3, 1, 0, 7]),
			cmd(122, 0, [2, 2, 0, 0, -4]),
			operand(1, 3),
			operand(2, 1, 6),
			operand(4, "$gameParty.gold()"),
			operand(4, "$gameParty.gold();"),
			operand(3, 0, 1, 0),
			operand(3, 1, 1, 0),
			operand(3, 2, 1, 0),
			operand(3, 3, 1, 0),
			operand(3, 3, 1, 11),
			operand(3, 4, 2, 1),
			operand(3, 4, 0, 9),
			operand(3, 5, -1, 0),
			operand(3, 5, 0, 1),
			operand(3, 5, 4, 3),
			operand(3, 6, 0, 0),
			operand(3, 7, 2, 0),
			operand(3, 7, 9, 0),
		]);
		expect(body(script)).toBe(
			[
				"variables.Day = 7;",
				"variables.Day += 7;",
				"variables.Day -= 7;",
				"variables.Day *= 7;",
				"variables.Day /= 7;",
				"variables.Day %= 7;",
				"variables.range(1, 3).add(7);",
				"variables.Knocks = -4;",
				"variables.Day = variables.Price;",
				"variables.Day = random(1, 6);",
				"variables.Day = script(() => $gameParty.gold());",
				'variables.Day = script("$gameParty.gold();");',
				"variables.Day = party.count(items.Lantern);",
				"variables.Day = party.count(weapons.Club);",
				"variables.Day = party.count(armors.Cloak);",
				"variables.Day = actors.Mira.level;",
				"variables.Day = actors.Mira.luck;",
				"variables.Day = troop.members[2].mp;",
				"variables.Day = troop.members[0].luck;",
				"variables.Day = player.x;",
				"variables.Day = event.y;",
				"variables.Day = map.events[4].screenX;",
				"variables.Day = party.members[0];",
				"variables.Day = party.gold;",
				"variables.Day = game.escapeCount;",
			].join("\n"),
		);
		expect(script.text).toContain("(event) => {");
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("keeps values the syntax can't reproduce raw", () => {
		const script = decompileList([
			cmd(121, 0, [1, 1, 2]),
			cmd(121, 0, [1, 1, 0, 0]),
			cmd(122, 0, [1, 1, 6, 0, 1]),
			cmd(122, 0, [1, 1, 0, 0, 1, 2]),
			cmd(122, 0, [1, 1, 0, 3, 0, 1, 5]),
			cmd(122, 0, [1, 1, 0, 3, 6, 0, 1]),
			cmd(122, 0, [1, 1, 0, 3, 7, 10, 0]),
			cmd(122, 0, [1, 1, 0, 3, 3, 1, 12]),
			cmd(122, 0, [1, 1, 0, 4, "two\nlines"]),
			cmd(123, 0, ["E", 0]),
			cmd(124, 0, [1, 30]),
		]);
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({
			121: 2,
			122: 7,
			123: 1,
			124: 1,
		});
	});

	it("breaks long names as Prettier does", async () => {
		const long =
			"A switch name long enough that not even the assignment of a boolean fits on one line";
		const symbols = createSymbols(createNames({ switches: ["", long], variables: ["", long] }, {}));
		const container: ScriptContainer = {
			kind: "commonEvent",
			id: 1,
			commonEvent: {
				id: 1,
				name: "Test",
				trigger: 0,
				switchId: 1,
				list: [
					cmd(121, 0, [1, 1, 0]),
					cmd(122, 0, [1, 1, 0, 2, 1, 60000]),
					cmd(122, 0, [1, 1, 0, 3, 3, 1, 2]),
					...ifOnly([1, 1, 0, 5, 1]),
					END,
				],
			},
		};
		const script = decompileDocument([container], { symbols });
		// After a left side that can break, even a boolean moves to the next line.
		expect(script.text).toContain('on one line"] =\n\t\ttrue;');
		await expectPrettierStable(script);
	});
});

describeWithGame("flow renderers on the configured test game", (game) => {
	it(
		"prints every flow-control and game-state command with dedicated syntax",
		{ timeout: 120_000 },
		async () => {
			const project = await loadProject(game);
			// Count the nodes each renderer declines. Commands inside blocks printed raw (such as
			// choices, until #42) never reach a renderer, so they aren't counted.
			const declined = new Map<number, number>();
			const renderers = new Map(
				[...RENDERERS].map(([code, renderer]): [number, CommandRenderer] => [
					code,
					(node, renderContext) => {
						const doc = renderer(node, renderContext);
						if (doc === undefined) {
							declined.set(code, (declined.get(code) ?? 0) + 1);
						}
						return doc;
					},
				]),
			);
			const decompileContext = { symbols: project.symbols, renderers };
			const scripts: DecompiledScript[] = [
				decompileDocument(
					project.commonEvents.flatMap((event, id) =>
						event ? [{ kind: "commonEvent" as const, id, commonEvent: event }] : [],
					),
					decompileContext,
				),
				decompileDocument(
					project.troops.flatMap((troop, id) =>
						troop ? [{ kind: "troop" as const, id, troop }] : [],
					),
					decompileContext,
				),
			];
			for (const mapId of project.mapIds()) {
				const map = await project.map(mapId);
				scripts.push(
					decompileDocument(
						map.events.flatMap((event, id) =>
							event ? [{ kind: "mapEvent" as const, mapId, id, event, mapEvents: map.events }] : [],
						),
						decompileContext,
					),
				);
			}
			const coverage = sumCoverage(scripts.map((script) => script.coverage));
			const raw = [...coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
			console.log(
				`flow renderers: raw fallback now ${raw} of ${coverage.commands} commands ` +
					`(${((100 * raw) / coverage.commands).toFixed(1)}%); declined: ` +
					JSON.stringify(Object.fromEntries(declined)),
			);
			expect(Object.fromEntries(declined)).toEqual({});
		},
	);
});
