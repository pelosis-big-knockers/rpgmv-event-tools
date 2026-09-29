import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import {
	createNames,
	createSymbols,
	decompile,
	decompileDocument,
	loadProject,
	locationKey,
	resolveMvProject,
	sumCoverage,
	type CommandRenderer,
	type CommonEvent,
	type DecompileContext,
	type DecompiledScript,
	type EventCommand,
	type EventPage,
	type EventPageConditions,
	type IndexRange,
	type ListLocation,
	type MapEvent,
	type MvProject,
	type ScriptContainer,
	type Troop,
	type TroopPage,
	type TroopPageConditions,
} from "../src/index.js";
import { hardline, indent } from "../src/layout.js";
import { describeWithGame } from "./support/test-game.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/basic", import.meta.url));

/** Formats with this repo's Prettier settings. */
function format(text: string): Promise<string> {
	return prettier.format(text, { parser: "typescript", useTabs: true, printWidth: 100 });
}

/** Checks that Prettier leaves a script exactly as printed. */
async function expectPrettierStable(script: DecompiledScript): Promise<void> {
	expect(await format(script.text)).toBe(script.text);
}

/** Symbols for inline tests. */
const context: DecompileContext = {
	symbols: createSymbols(
		createNames(
			{
				switches: ["", "Lantern lit", "Gate_open", "", "Dup", "Dup"],
				variables: ["", "Day", "Knocks"],
			},
			{
				item: [null, { name: "Rusty key" }, { name: "Lantern" }],
				actor: [null, { name: "Mira" }],
				commonEvent: [null, { name: "Open chest" }],
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

function commonEvent(list: EventCommand[], extra: Partial<CommonEvent> = {}): ScriptContainer {
	return {
		kind: "commonEvent",
		id: 1,
		commonEvent: { id: 1, name: "Test", trigger: 0, switchId: 1, list, ...extra },
	};
}

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

function mapPage(conditions: Partial<EventPageConditions>, list = [END], trigger = 0): EventPage {
	return { conditions: { ...NO_MAP_CONDITIONS, ...conditions }, trigger, list } as EventPage;
}

function mapEvent(pages: EventPage[], name = "Old gate"): ScriptContainer {
	const event = { id: 4, name, note: "", x: 12, y: 8, pages } as MapEvent;
	return { kind: "mapEvent", mapId: 3, id: 4, event };
}

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

function troop(conditions: Partial<TroopPageConditions>[]): ScriptContainer {
	const pages = conditions.map((page): TroopPage => ({
		conditions: { ...NO_TROOP_CONDITIONS, ...page },
		span: 0,
		list: [END],
	}));
	return { kind: "troop", id: 7, troop: { id: 7, name: "Cave bats", members: [], pages } as Troop };
}

async function fixtureDocuments(project: MvProject) {
	const symbols = { symbols: project.symbols };
	const map = await project.map(1);
	return {
		commonEvents: decompileDocument(
			project.commonEvents.flatMap((event, id) =>
				event ? [{ kind: "commonEvent" as const, id, commonEvent: event }] : [],
			),
			symbols,
		),
		map: decompileDocument(
			map.events.flatMap((event, id) =>
				event ? [{ kind: "mapEvent" as const, mapId: 1, id, event }] : [],
			),
			symbols,
		),
		troops: decompileDocument(
			project.troops.flatMap((entry, id) =>
				entry ? [{ kind: "troop" as const, id, troop: entry }] : [],
			),
			symbols,
		),
	};
}

describe("decompileDocument on the fixture", () => {
	it("prints common events, map events and troops", async () => {
		const location = await resolveMvProject(FIXTURE);
		const documents = await fixtureDocuments(await loadProject(location!));

		expect(documents.commonEvents.text).toBe(
			[
				'/// <reference types="rpgmv-event-tools" />',
				"",
				'defineCommonEvent({ id: 1, name: "Toggle lantern", trigger: "none" }, () => {',
				'\tif (switches["Lantern lit"]) {',
				'\t\tswitches["Lantern lit"] = false;',
				'\t\tcommand(101, ["", 0, 0, 2]);',
				'\t\tcommand(401, ["You put out the lantern."]);',
				"\t} else {",
				'\t\tswitches["Lantern lit"] = true;',
				'\t\tcommand(101, ["", 0, 0, 2]);',
				'\t\tcommand(401, ["You light the lantern."]);',
				"\t}",
				"});",
				"",
				'defineCommonEvent({ id: 2, name: "Greet keeper", trigger: "none" }, () => {',
				'\tcommand(101, ["", 0, 0, 2]);',
				'\tcommand(401, ["Welcome, traveller."]);',
				'\tcommand(102, [["Ask about the door", "Leave"], 1, 0, 2, 0]);',
				'\tcommand(402, [0, "Ask about the door"]);',
				'\tcommand(101, ["", 0, 0, 2], { indent: 1 });',
				'\tcommand(401, ["The door opens for those who carry a light."], { indent: 1 });',
				"\tcommand(121, [3, 3, 0], { indent: 1 });",
				"\tcommand(0, [], { indent: 1 });",
				'\tcommand(402, [1, "Leave"]);',
				"\tcommand(0, [], { indent: 1 });",
				"\tcommand(404, []);",
				"});",
				"",
				'defineCommonEvent({ id: 3, name: "Count visit", trigger: "none" }, () => {',
				"\tvariables.Visits += 1;",
				'\tcommonEvents["Toggle lantern"]();',
				"});",
				"",
			].join("\n"),
		);
		expect(documents.map.text).toBe(
			[
				'/// <reference types="rpgmv-event-tools" />',
				"",
				'defineMapEvent({ id: 1, name: "Keeper", x: 1, y: 1 }, [',
				'\tpage({ trigger: "action" }, () => {',
				'\t\tcommonEvents["Greet keeper"]();',
				"\t}),",
				'\tpage({ trigger: "action", when: () => switches["Met the keeper"] }, () => {',
				'\t\tcommand(101, ["", 0, 0, 2]);',
				'\t\tcommand(401, ["Go on, the door is open."]);',
				"\t}),",
				"]);",
				"",
			].join("\n"),
		);
		expect(documents.troops.text).toBe(
			[
				'/// <reference types="rpgmv-event-tools" />',
				"",
				'defineTroop({ id: 1, name: "Cellar Bats" }, [',
				'\tpage({ span: "battle", when: () => troop.turn(1) }, () => {',
				'\t\tcommand(101, ["", 0, 0, 2]);',
				'\t\tcommand(401, ["More bats pour out of the dark!"]);',
				"\t\tcommand(335, [1]);",
				"\t}),",
				'\tpage({ span: "battle" }, () => {}),',
				"]);",
				"",
			].join("\n"),
		);
		for (const script of Object.values(documents)) {
			await expectPrettierStable(script);
		}
	});

	it("maps lines to containers, pages and commands, and back", async () => {
		const location = await resolveMvProject(FIXTURE);
		const { map } = await fixtureDocuments(await loadProject(location!));
		const page = (pageIndex: number): ListLocation => ({
			kind: "mapEvent",
			mapId: 1,
			eventId: 1,
			pageIndex,
		});

		expect(map.sourceMap.at(2).map((segment) => segment.target.kind)).toEqual(["container"]);
		expect(map.sourceMap.at(6).map((segment) => segment.target)).toEqual([
			{ kind: "page", container: { kind: "mapEvent", mapId: 1, eventId: 1 }, pageIndex: 1 },
			{ kind: "container", container: { kind: "mapEvent", mapId: 1, eventId: 1 } },
		]);
		expect(map.sourceMap.at(7)[0]?.target).toEqual({
			kind: "commands",
			location: page(1),
			start: 0,
			end: 1,
		});
		expect(map.sourceMap.linesOf(page(1), 1)).toEqual({ startLine: 8, endLine: 8 });
		// The list's final `0` is the closing line of its body.
		expect(map.sourceMap.linesOf(page(1), 2)).toEqual({ startLine: 9, endLine: 9 });
		expect(map.sourceMap.linesOf(page(1), 3)).toBeUndefined();
		expect(map.sourceMap.linesOf(page(5), 0)).toBeUndefined();
	});
});

describe("decompileDocument layout", () => {
	it("hugs the body, and breaks the options object when the header is too long", async () => {
		const script = decompileDocument(
			[
				commonEvent([cmd(230, 0, [60]), END], {
					name: "A name that is really quite long, long enough to push the line well over",
					trigger: 2,
					switchId: 2,
				}),
			],
			context,
		);
		expect(script.text).toBe(
			[
				'/// <reference types="rpgmv-event-tools" />',
				"",
				"defineCommonEvent(",
				"\t{",
				"\t\tid: 1,",
				'\t\tname: "A name that is really quite long, long enough to push the line well over",',
				'\t\ttrigger: "parallel",',
				"\t\tswitch: switches.Gate_open,",
				"\t},",
				"\t() => {",
				"\t\tcommand(230, [60]);",
				"\t},",
				");",
				"",
			].join("\n"),
		);
		await expectPrettierStable(script);
	});

	it("prints raw parameters as literals Prettier leaves alone", async () => {
		const list = [
			cmd(401, 0, [`She said "hi" and 'bye'. \\c[2]\\{\n`]),
			cmd(401, 0, [`It's "quoted"" twice`]),
			cmd(401, 0, ["Tür \u0001   日本語のテキスト"]),
			cmd(250, 0, [{ name: "Cursor1", pan: 0, pitch: 100, volume: 90 }]),
			cmd(205, 0, [
				-1,
				{
					list: [
						{ code: 1, indent: null },
						{ code: 0, parameters: [] },
					],
					repeat: false,
					skippable: false,
					wait: true,
				},
			]),
			cmd(223, 0, [[-68, -68, 0, 68], 60, true]),
			cmd(232, 0, [1, 0, 0, 0, 408, 312, 100, 100, 255, 0, 60, true, 1, 0, 0, 0, 408, 312, 100]),
			cmd(999, 0, [1.5, 1e21, 2.5e-7, null, { "not an identifier": 1, "1": 2, ok: 3 }]),
			cmd(355, 3, [
				"a very long script line that goes on and on and on and on and on and on and on",
			]),
			{ indent: 0, code: 108, parameters: ["keys out of order"] },
			{ code: 108, indent: 0, parameters: ["an extra key"], plugin: true } as EventCommand,
			END,
		];
		const script = decompileDocument([commonEvent(list)], context);
		// As many `"` as `'`: Prettier keeps double quotes.
		expect(script.text).toContain(
			`command(401, ["She said \\"hi\\" and 'bye'. \\\\c[2]\\\\{\\n"]);`,
		);
		expect(script.text).toContain(`command(401, ['It\\'s "quoted"" twice']);`);
		expect(script.text).toContain(
			'command({ indent: 0, code: 108, parameters: ["keys out of order"] });',
		);
		expect(script.text).toContain(
			'command({ code: 108, indent: 0, parameters: ["an extra key"], plugin: true });',
		);
		// JavaScript orders integer-like keys first, as JSON.parse already did.
		expect(script.text).toContain('{ "1": 2, "not an identifier": 1, ok: 3 }');
		expect(script.text).toContain("1e21");
		expect(script.coverage.rawByCode.get(401)).toBe(3);
		await expectPrettierStable(script);
	});

	it("marks a list without the final 0 with end: false", async () => {
		const script = decompileDocument(
			[commonEvent([cmd(230, 0, [60])]), mapEvent([mapPage({}, [])])],
			context,
		);
		expect(script.text).toContain('trigger: "none", end: false }');
		expect(script.text).toContain('page({ trigger: "action", end: false }, () => {})');
		await expectPrettierStable(script);
	});

	it("prints names that need other delimiters", async () => {
		const script = decompileDocument(
			[
				commonEvent([END], { name: 'Say "hi"' }),
				commonEvent([END], { name: `"It's" late` }),
				commonEvent([END], { name: "Ends with \\" }),
			],
			context,
		);
		expect(script.text).toContain(`name: 'Say "hi"'`);
		expect(script.text).toContain('name: `"It\'s" late`');
		expect(script.text).toContain('name: "Ends with \\"');
	});
});

describe("page conditions", () => {
	it("prints every map page check, in the editor's order", async () => {
		const script = decompileDocument(
			[
				mapEvent([
					mapPage({ switch1Valid: true, switch1Id: 2 }),
					mapPage({
						actorValid: true,
						itemValid: true,
						itemId: 2,
						selfSwitchValid: true,
						selfSwitchCh: "B",
						variableValid: true,
						variableId: 1,
						variableValue: -3,
						switch2Valid: true,
						switch2Id: 1,
						switch1Valid: true,
						switch1Id: 5,
					}),
					mapPage({ selfSwitchValid: true }, [END], 1),
				]),
			],
			context,
		);
		expect(script.text).toBe(
			[
				'/// <reference types="rpgmv-event-tools" />',
				"",
				'defineMapEvent({ id: 4, name: "Old gate", x: 12, y: 8 }, [',
				'\tpage({ trigger: "action", when: () => switches.Gate_open }, () => {}),',
				"\tpage(",
				"\t\t{",
				'\t\t\ttrigger: "action",',
				"\t\t\twhen: (event) =>",
				"\t\t\t\tswitches[5] &&",
				'\t\t\t\tswitches["Lantern lit"] &&',
				"\t\t\t\tvariables.Day >= -3 &&",
				"\t\t\t\tevent.selfSwitches.B &&",
				"\t\t\t\tparty.has(items.Lantern) &&",
				"\t\t\t\tparty.has(actors.Mira),",
				"\t\t},",
				"\t\t() => {},",
				"\t),",
				'\tpage({ trigger: "playerTouch", when: (event) => event.selfSwitches.A }, () => {}),',
				"]);",
				"",
			].join("\n"),
		);
		await expectPrettierStable(script);
	});

	it("keeps conditions `when` can't express as stored", async () => {
		const script = decompileDocument(
			[
				mapEvent([
					mapPage({ selfSwitchValid: true, selfSwitchCh: "E" }),
					mapPage({ switch1Valid: 1 as unknown as boolean }),
				]),
			],
			context,
		);
		expect(script.text).toContain("conditions: {\n\t\t\t\tswitch1Valid: false,");
		expect(script.text).toContain('selfSwitchCh: "E"');
		expect(script.text).toContain("switch1Valid: 1,");
		expect(script.text).not.toContain("when:");
		await expectPrettierStable(script);
	});

	it("prints every troop page check", async () => {
		const script = decompileDocument(
			[
				troop([
					{ turnValid: true, turnA: 0 },
					{ turnValid: true, turnA: 2, turnB: 3, turnEnding: true },
					{ enemyValid: true, enemyIndex: 1, enemyHp: 50, switchValid: true, switchId: 1 },
					{ actorValid: true, actorId: 1, actorHp: 25 },
					{},
				]),
			],
			context,
		);
		expect(script.text).toContain('page({ span: "battle", when: () => troop.turn(0) }');
		expect(script.text).toContain("when: () => troop.turnEnding && troop.turn(2, 3) }");
		expect(script.text).toContain(
			'when: () => troop.members[1].hpPercent <= 50 && switches["Lantern lit"]',
		);
		expect(script.text).toContain("when: () => actors.Mira.hpPercent <= 25 }");
		expect(script.text).toContain('page({ span: "battle" }, () => {}),');
		await expectPrettierStable(script);
	});
});

describe("renderers", () => {
	/** Wait as `wait(frames)`, but only for whole frame counts. */
	const wait: CommandRenderer = (node, { list }) => {
		const frames = list[node.start]?.parameters[0];
		return Number.isInteger(frames) ? `wait(${String(frames)});` : undefined;
	};
	/** Conditional branch on a switch, as `if (…) { … }`, using the body and segment helpers. */
	const ifSwitch: CommandRenderer = (node, context) => {
		const branch =
			node.kind === "block" && node.branches.length === 1 ? node.branches[0] : undefined;
		if (!branch) {
			return undefined;
		}
		const body = context.body(branch.body);
		context.useEvent();
		return [
			`if (switches[${String(context.list[node.start]?.parameters[1])}]) {`,
			indent(body.flatMap((doc) => [hardline, doc])),
			hardline,
			context.segment(branch.terminatorIndex, node.end, "}"),
		];
	};

	it("uses a command's renderer, and the raw fallback when it declines", async () => {
		const renderers = new Map([
			[230, wait],
			[111, ifSwitch],
		]);
		const list = [
			cmd(111, 0, [0, 1, 0]),
			cmd(230, 1, [60]),
			cmd(230, 1, [0.5]),
			cmd(0, 1),
			cmd(412, 0),
			END,
		];
		const script = decompileDocument([commonEvent(list)], { ...context, renderers });
		expect(script.text).toBe(
			[
				'/// <reference types="rpgmv-event-tools" />',
				"",
				'defineCommonEvent({ id: 1, name: "Test", trigger: "none" }, (event) => {',
				"\tif (switches[1]) {",
				"\t\twait(60);",
				"\t\tcommand(230, [0.5]);",
				"\t}",
				"});",
				"",
			].join("\n"),
		);
		const location: ListLocation = { kind: "commonEvent", commonEventId: 1 };
		expect(script.sourceMap.linesOf(location, 0)).toEqual({ startLine: 3, endLine: 6 });
		expect(script.sourceMap.linesOf(location, 2)).toEqual({ startLine: 5, endLine: 5 });
		expect(script.sourceMap.linesOf(location, 4)).toEqual({ startLine: 6, endLine: 6 });
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({ 230: 1 });
	});

	it("undoes what a declining renderer recorded", () => {
		const declineAfterBody: CommandRenderer = (node, context) => {
			if (node.kind === "block") {
				context.body(node.branches[0]!.body);
				context.useEvent();
			}
			return undefined;
		};
		const list = [cmd(111, 0, [0, 1, 0]), cmd(230, 1, [60]), cmd(0, 1), cmd(412, 0), END];
		const script = decompileDocument([commonEvent(list)], {
			...context,
			renderers: new Map([[111, declineAfterBody]]),
		});
		expect(script.text).toContain("() => {");
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({ 0: 1, 111: 1, 230: 1, 412: 1 });
		expect(script.sourceMap.segments.every((segment) => segment.startLine >= 0)).toBe(true);
	});
});

describe("decompile", () => {
	it("prints one list's statements without a container", () => {
		const location: ListLocation = { kind: "commonEvent", commonEventId: 1 };
		const script = decompile({ location, list: [cmd(230, 0, [60]), END] }, context);
		expect(script.text).toBe("command(230, [60]);\n");
		expect(script.sourceMap.linesOf(location, 0)).toEqual({ startLine: 0, endLine: 0 });
		expect(script.coverage).toEqual({ commands: 2, rawByCode: new Map([[230, 1]]) });
	});
});

/**
 * What's wrong with how `ranges` (the commands segments of one list) cover a list of `length`
 * commands, if anything. Segments may nest but not partly overlap, and every command must be in
 * one, so each command has exactly one innermost segment.
 */
function coverageProblem(ranges: readonly IndexRange[], length: number): string | undefined {
	const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
	const open: IndexRange[] = [];
	const covered = Array.from({ length }, () => false);
	for (const range of sorted) {
		if (range.start < 0 || range.end > length || range.end <= range.start) {
			return `segment [${range.start}, ${range.end}) is out of range`;
		}
		while (open.length > 0 && (open.at(-1) as IndexRange).end <= range.start) {
			open.pop();
		}
		const parent = open.at(-1);
		if (
			parent &&
			(range.end > parent.end || (range.start === parent.start && range.end === parent.end))
		) {
			return `segment [${range.start}, ${range.end}) overlaps [${parent.start}, ${parent.end})`;
		}
		open.push(range);
		covered.fill(true, range.start, range.end);
	}
	const gap = covered.indexOf(false);
	return gap === -1 ? undefined : `command ${gap} has no segment`;
}

describeWithGame("decompileDocument on the configured test game", (game) => {
	it(
		"decompiles every event, covering every command exactly once",
		{ timeout: 300_000 },
		async () => {
			const project = await loadProject(game);
			const symbols = { symbols: project.symbols };
			const documents: { name: string; containers: ScriptContainer[] }[] = [
				{
					name: "CommonEvents",
					containers: project.commonEvents.flatMap((event, id) =>
						event ? [{ kind: "commonEvent" as const, id, commonEvent: event }] : [],
					),
				},
				{
					name: "Troops",
					containers: project.troops.flatMap((entry, id) =>
						entry ? [{ kind: "troop" as const, id, troop: entry }] : [],
					),
				},
			];
			for (const mapId of project.mapIds()) {
				const map = await project.map(mapId);
				documents.push({
					name: `Map${mapId}`,
					containers: map.events.flatMap((event, id) =>
						event ? [{ kind: "mapEvent" as const, mapId, id, event }] : [],
					),
				});
			}
			const lists = new Map<string, number>();
			for await (const { location, list } of project.commandLists()) {
				lists.set(locationKey(location), list.length);
			}

			const started = performance.now();
			const scripts = documents.map(({ containers }) => decompileDocument(containers, symbols));
			const elapsed = performance.now() - started;

			const problems: string[] = [];
			const ranges = new Map<string, IndexRange[]>();
			let lines = 0;
			for (const script of scripts) {
				lines += script.text.split("\n").length - 1;
				for (const { target } of script.sourceMap.segments) {
					if (target.kind === "commands") {
						const key = locationKey(target.location);
						ranges.set(key, [...(ranges.get(key) ?? []), target]);
					}
				}
			}
			for (const [key, length] of lists) {
				const problem = coverageProblem(ranges.get(key) ?? [], length);
				if (problem) {
					problems.push(`${key}: ${problem}`);
				}
			}
			const coverage = sumCoverage(scripts.map((script) => script.coverage));
			const raw = [...coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
			const topRaw = [...coverage.rawByCode]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([code, count]) => `${code}: ${count}`)
				.join(", ");
			console.log(
				`decompiler: ${scripts.length} documents, ${lines} lines, ${coverage.commands} commands ` +
					`in ${elapsed.toFixed(0)} ms; raw fallback ${raw} (${((100 * raw) / coverage.commands).toFixed(1)}%), ` +
					`most by code: ${topRaw}`,
			);
			expect(coverage.commands).toBe([...lists.values()].reduce((sum, length) => sum + length, 0));
			expect(problems.slice(0, 10)).toEqual([]);

			// Prettier agrees with the layout: formatting changes nothing.
			for (const index of [0, 1, 2, 3, 4]) {
				const script = scripts[index];
				if (script) {
					await expectPrettierStable(script);
				}
			}
		},
	);
});
