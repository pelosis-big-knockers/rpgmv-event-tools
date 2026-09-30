import * as prettier from "prettier";
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
import { describeWithGame } from "./support/test-game.js";

const context: DecompileContext = {
	symbols: createSymbols(
		createNames({ switches: ["", "Door_open"], variables: ["", "Code", "Chosen"] }, {}),
	),
};

const cmd = (code: number, indent: number, parameters: unknown[] = []): EventCommand => ({
	code,
	indent,
	parameters,
});
const END = cmd(0, 0);
const LOCATION: ListLocation = { kind: "commonEvent", commonEventId: 1 };

function decompileList(list: EventCommand[], end: EventCommand[] = [END]): DecompiledScript {
	const container: ScriptContainer = {
		kind: "commonEvent",
		id: 1,
		commonEvent: { id: 1, name: "Test", trigger: 0, switchId: 1, list: [...list, ...end] },
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

/**
 * Checks that Prettier leaves a script as printed. Raw strings with text codes aren't valid
 * TypeScript (`\x`, a trailing `\`), so backslashes become another one-column character first.
 */
async function expectPrettierStable(script: DecompiledScript): Promise<void> {
	const text = script.text.replaceAll("\\", "§");
	const formatted = await prettier.format(text, {
		parser: "typescript",
		useTabs: true,
		printWidth: 100,
	});
	expect(formatted).toBe(text);
}

/** A command with its continuation lines, each holding one text. */
const withLines = (head: EventCommand, code: number, lines: string[]) => [
	head,
	...lines.map((text) => cmd(code, head.indent as number, [text])),
];

describe("show text", () => {
	it("prints options that aren't defaults, then the lines", async () => {
		const script = decompileList([
			...withLines(cmd(101, 0, ["", 0, 0, 2]), 401, ["Just one line."]),
			...withLines(cmd(101, 0, ["Guard", 2, 1, 1]), 401, [
				"Halt!",
				String.raw`\c[2]State your business.\c[0]`,
			]),
			cmd(101, 0, ["", 3, 2, 0]),
			cmd(101, 0, ["", 0, 0, 2]),
			...withLines(cmd(101, 0, ["", 0, 0, 2]), 401, [
				String.raw`\N[1]: \{Hey!\}`,
				'She said "hi".',
				`"It's late," he said.`,
			]),
		]);
		expect(body(script)).toBe(
			[
				'showText("Just one line.");',
				"showText(",
				'\t{ face: "Guard", faceIndex: 2, background: "dim", position: "middle" },',
				'\t"Halt!",',
				String.raw`	"\c[2]State your business.\c[0]",`,
				");",
				'showText({ faceIndex: 3, background: "transparent", position: "top" });',
				"showText();",
				String.raw`showText("\N[1]: \{Hey!\}", 'She said "hi".', ` + '`"It\'s late," he said.`);',
			].join("\n"),
		);
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("keeps commands it can't print exactly as raw commands", () => {
		const script = decompileList([
			cmd(101, 0, ["", 0, 0]),
			cmd(101, 0, ["", "1", 0, 2]),
			cmd(101, 0, ["", -1, 0, 2]),
			cmd(101, 0, ["", 0, 3, 2]),
			cmd(101, 0, ["", 0, 0, 2, 0]),
			cmd(101, 0, [0, 0, 0, 2]),
			...withLines(cmd(101, 0, ["", 0, 0, 2]), 401, ["two\nlines"]),
			cmd(101, 0, ["", 0, 0, 2]),
			cmd(401, 0, ["a", "b"]),
		]);
		expect(script.coverage.rawByCode.get(101)).toBe(8);
		expect(script.text).not.toContain("showText");
	});
});

describe("show choices", () => {
	it("prints choices, cancel, options and the cancel branch", async () => {
		const script = decompileList([
			cmd(102, 0, [["Buy", "Sell"], -2, -1, 1, 1]),
			cmd(402, 0, [0, "Buy"]),
			cmd(113, 1),
			cmd(0, 1),
			cmd(402, 0, [1, "Sell"]),
			cmd(0, 1),
			cmd(403, 0, [6, null]),
			cmd(115, 1),
			cmd(0, 1),
			cmd(404, 0),
			cmd(102, 0, [["A", "B"], 5, 1, 0, 2]),
			cmd(402, 0, [0, "A"]),
			cmd(0, 1),
			cmd(402, 0, [1, "B"]),
			cmd(0, 1),
			cmd(404, 0),
			cmd(112, 0),
			cmd(102, 1, [["Stay", "Go"], -1, 0, 2, 0]),
			cmd(402, 1, [0, "Stay"]),
			cmd(0, 2),
			cmd(402, 1, [1, "Go"]),
			cmd(113, 2),
			cmd(0, 2),
			cmd(404, 1),
			cmd(0, 1),
			cmd(413, 0),
		]);
		expect(body(script)).toBe(
			[
				"showChoices(",
				"\t[",
				'\t\tchoice("Buy", () => {',
				"\t\t\tbreakLoop();",
				"\t\t}),",
				'\t\tchoice("Sell", () => {}),',
				"\t],",
				"\t{",
				'\t\tcancel: "branch",',
				'\t\tdefault: "none",',
				'\t\tposition: "middle",',
				'\t\tbackground: "dim",',
				"\t\tonCancel: () => {",
				"\t\t\texitEventProcessing();",
				"\t\t},",
				"\t},",
				");",
				'showChoices([choice("A", () => {}), choice("B", () => {})], {',
				"\tcancel: 5,",
				"\tdefault: 1,",
				'\tposition: "left",',
				'\tbackground: "transparent",',
				"});",
				"loop((loop) => {",
				"\tshowChoices(",
				"\t\t[",
				'\t\t\tchoice("Stay", () => {}),',
				'\t\t\tchoice("Go", () => {',
				"\t\t\t\tloop.break();",
				"\t\t\t}),",
				"\t\t],",
				'\t\t{ cancel: "disallow" },',
				"\t);",
				"});",
			].join("\n"),
		);
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("keeps choices whose derived data doesn't match raw", () => {
		const choices = (parameters: unknown[], ...branches: EventCommand[][]) => [
			cmd(102, 0, parameters),
			...branches.flatMap((header) => [...header, cmd(0, 1)]),
			cmd(404, 0),
		];
		const script = decompileList([
			...choices([["A"], 0, 0, 2, 0], [cmd(402, 0, [0, "B"])]),
			...choices([["A"], 0, 0, 2, 0], [cmd(402, 0, [1, "A"])]),
			...choices([["A"], 0, 0, 2, 0], [cmd(402, 0, [0, "A", 1])]),
			...choices([["A"], 0, 0, 2, 0], [cmd(402, 0, [0, "A"])], [cmd(403, 0, [5, null])]),
			...choices([["A", "B"], 0, 0, 2, 0], [cmd(402, 0, [0, "A"])]),
			...choices([["A"], 0, 0, 2], [cmd(402, 0, [0, "A"])]),
			...choices([["A"], -3, 0, 2, 0], [cmd(402, 0, [0, "A"])]),
			...choices([["A"], 0, -2, 2, 0], [cmd(402, 0, [0, "A"])]),
			...choices([["A"], 0, 0, 3, 0], [cmd(402, 0, [0, "A"])]),
			...choices([["a\nb"], 0, 0, 2, 0], [cmd(402, 0, [0, "a\nb"])]),
			...choices([["A"], 0, 0, 2, 0], [cmd(403, 0, [6, null])], [cmd(402, 0, [0, "A"])]),
		]);
		expect(script.coverage.rawByCode.get(102)).toBe(11);
		expect(script.text).not.toContain("showChoices");
	});

	it("maps each branch's lines to its commands", () => {
		const script = decompileList([
			cmd(102, 0, [["Yes", "No"], -2, 0, 2, 0]),
			cmd(402, 0, [0, "Yes"]),
			cmd(230, 1, [60]),
			cmd(0, 1),
			cmd(402, 0, [1, "No"]),
			cmd(0, 1),
			cmd(403, 0, [6, null]),
			cmd(115, 1),
			cmd(0, 1),
			cmd(404, 0),
		]);
		const lineOf = (index: number) => script.sourceMap.linesOf(LOCATION, index);
		// Lines 3 `showChoices(`, 5 `choice("Yes", …`, 6 its body, 7 `}),`, 8 `choice("No", …`,
		// 12 `onCancel: () => {`, 13 its body, 14 `},`, 16 `);`.
		expect(script.text.split("\n")[12]).toBe("\t\t\tonCancel: () => {");
		expect(lineOf(0)).toEqual({ startLine: 3, endLine: 16 });
		expect(lineOf(1)).toEqual({ startLine: 5, endLine: 5 });
		expect(lineOf(2)).toEqual({ startLine: 6, endLine: 6 });
		expect(lineOf(3)).toEqual({ startLine: 7, endLine: 7 });
		expect(lineOf(4)).toEqual({ startLine: 8, endLine: 8 });
		expect(lineOf(5)).toEqual({ startLine: 8, endLine: 8 });
		expect(lineOf(6)).toEqual({ startLine: 12, endLine: 12 });
		expect(lineOf(7)).toEqual({ startLine: 13, endLine: 13 });
		expect(lineOf(8)).toEqual({ startLine: 14, endLine: 14 });
		expect(lineOf(9)).toEqual({ startLine: 16, endLine: 16 });
	});
});

describe("input number, select item and scrolling text", () => {
	it("prints them as calls", async () => {
		const script = decompileList([
			cmd(103, 0, [1, 4]),
			cmd(104, 0, [2, 2]),
			cmd(104, 0, [9, 4]),
			...withLines(cmd(105, 0, [2, false]), 405, ["Long ago...", ""]),
			cmd(105, 0, [4, true]),
		]);
		expect(body(script)).toBe(
			[
				"inputNumber(variables.Code, 4);",
				'selectItem(variables.Chosen, "keyItem");',
				'selectItem(variables[9], "hiddenItemB");',
				'showScrollingText("Long ago...", "");',
				"showScrollingText({ speed: 4, noFastForward: true });",
			].join("\n"),
		);
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("keeps unexpected parameters raw", () => {
		const script = decompileList([
			cmd(103, 0, [1]),
			cmd(103, 0, [1, 4.5]),
			cmd(104, 0, [2, 0]),
			cmd(104, 0, [2, 5]),
			cmd(104, 0, [-2, 1]),
			cmd(105, 0, [2, 0]),
			cmd(105, 0, [-0, false]),
			...withLines(cmd(105, 0, [2, false]), 405, ["a\rb"]),
		]);
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({
			103: 2,
			104: 3,
			105: 3,
			405: 1,
		});
	});
});

describe("comments", () => {
	it("prints // lines, a blank line between comments, and comment(…) where needed", async () => {
		const script = decompileList([
			...withLines(cmd(108, 0, ["<follower touch>"]), 408, ["Triggers when touched.", ""]),
			cmd(108, 0, ["second comment"]),
			cmd(230, 0, [60]),
			...withLines(cmd(108, 0, ["trailing space "]), 408, ["ok"]),
			cmd(111, 0, [0, 1, 0]),
			cmd(108, 1, ["only one"]),
			cmd(0, 1),
			cmd(411, 0),
			cmd(108, 1, ["first"]),
			cmd(108, 1, ["second"]),
			cmd(0, 1),
			cmd(412, 0),
			cmd(108, 0, ["  indented"]),
			cmd(108, 0, [String.raw`\c[2] ends with ` + "\\"]),
		]);
		expect(body(script)).toBe(
			[
				"// <follower touch>",
				"// Triggers when touched.",
				"//",
				"",
				"// second comment",
				"command(230, [60]);",
				'comment("trailing space ", "ok");',
				"if (switches.Door_open) {",
				"\t// only one",
				"} else {",
				"\t// first",
				"",
				// Prettier would drop the blank line between comments alone in a body.
				'\tcomment("second");',
				"}",
				"//   indented",
				"",
				String.raw`// \c[2] ends with ` + "\\",
			].join("\n"),
		);
		expect(script.coverage.rawByCode.get(230)).toBe(1);
		expect(script.coverage.rawByCode.size).toBe(1);
		await expectPrettierStable(script);
	});

	it("keeps the comments of a body that has nothing else apart", async () => {
		const script = decompileList([
			cmd(108, 0, ["a"]),
			cmd(108, 0, ["b"]),
			cmd(102, 0, [["A"], 0, 0, 2, 0]),
			cmd(402, 0, [0, "A"]),
			cmd(108, 1, ["x"]),
			cmd(108, 1, ["y "]),
			cmd(108, 1, ["z"]),
			cmd(0, 1),
			cmd(404, 0),
		]);
		expect(body(script)).toBe(
			[
				"// a",
				"",
				"// b",
				"showChoices(",
				"\t[",
				'\t\tchoice("A", () => {',
				"\t\t\t// x",
				"",
				'\t\t\tcomment("y ");',
				"",
				"\t\t\t// z",
				"\t\t}),",
				"\t],",
				"\t{ cancel: 0 },",
				");",
			].join("\n"),
		);
		const onlyComments = decompileList([cmd(108, 0, ["a"]), cmd(108, 0, ["b"])]);
		expect(body(onlyComments)).toBe(["// a", "", 'comment("b");'].join("\n"));
		await expectPrettierStable(script);
		await expectPrettierStable(onlyComments);
	});

	it("maps comment lines to their commands", () => {
		const script = decompileList([
			...withLines(cmd(108, 0, ["one"]), 408, ["two"]),
			cmd(108, 0, ["three"]),
		]);
		expect(script.sourceMap.linesOf(LOCATION, 0)).toEqual({ startLine: 3, endLine: 4 });
		expect(script.sourceMap.linesOf(LOCATION, 1)).toEqual({ startLine: 3, endLine: 4 });
		expect(script.sourceMap.linesOf(LOCATION, 2)).toEqual({ startLine: 6, endLine: 6 });
	});

	it("keeps comments without text raw", () => {
		const script = decompileList([cmd(108, 0, [1]), cmd(108, 0, ["a", "b"]), cmd(108, 0, [])]);
		expect(script.coverage.rawByCode.get(108)).toBe(3);
	});
});

describe("scripts and plugin commands", () => {
	it("prints script lines", async () => {
		const script = decompileList([
			...withLines(cmd(355, 0, ["const a = 1;"]), 655, ["$gameVariables.setValue(1, a);"]),
			cmd(355, 0, ["this.wait(10);"]),
			cmd(355, 0, [1]),
		]);
		expect(body(script)).toBe(
			[
				'script("const a = 1;", "$gameVariables.setValue(1, a);");',
				'script("this.wait(10);");',
				"command(355, [1]);",
			].join("\n"),
		);
		await expectPrettierStable(script);
	});

	it("splits plugin commands at single spaces", async () => {
		const cases: [string, string][] = [
			["Lighting on 3", 'plugin.Lighting("on", 3);'],
			["Fog show 1 0.5", 'plugin.Fog("show", 1, 0.5);'],
			["QuestLog add 007", 'plugin.QuestLog("add", "007");'],
			["Shake -5 1e+21 -0 Infinity", 'plugin.Shake(-5, 1e21, "-0", "Infinity");'],
			["Clear", "plugin.Clear();"],
			["if x", 'plugin.if("x");'],
			['Say "hi"', "plugin.Say('\"hi\"');"],
			["Weather  rain", 'plugin("Weather  rain");'],
			["Layer.set(1);", 'plugin("Layer.set(1);");'],
			[" Lead", 'plugin(" Lead");'],
			["Trail ", 'plugin("Trail ");'],
			["", 'plugin("");'],
		];
		const script = decompileList([
			...cases.map(([text]) => cmd(356, 0, [text])),
			cmd(356, 0, [1]),
			cmd(356, 0, ["a", "b"]),
			cmd(356, 0, ["a\nb"]),
		]);
		expect(body(script)).toBe(
			[
				...cases.map(([, printed]) => printed),
				"command(356, [1]);",
				'command(356, ["a", "b"]);',
				'command(356, ["a\\nb"]);',
			].join("\n"),
		);
		await expectPrettierStable(script);
	});
});

describeWithGame("message renderers on the configured test game", (game) => {
	it(
		"prints every message, comment, script and plugin command with dedicated syntax",
		{ timeout: 120_000 },
		async () => {
			const project = await loadProject(game);
			const codes = new Set([101, 102, 103, 104, 105, 108, 355, 356]);
			const declined = new Map<number, number>();
			const renderers = new Map(
				[...RENDERERS].map(([code, renderer]): [number, CommandRenderer] => [
					code,
					(node, renderContext) => {
						const doc = renderer(node, renderContext);
						if (doc === undefined && codes.has(code)) {
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
							event ? [{ kind: "mapEvent" as const, mapId, id, event }] : [],
						),
						decompileContext,
					),
				);
			}
			const coverage = sumCoverage(scripts.map((script) => script.coverage));
			const raw = [...coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
			const rawHere = [...coverage.rawByCode].filter(([code]) => codes.has(code));
			console.log(
				`message renderers: raw fallback now ${raw} of ${coverage.commands} commands ` +
					`(${((100 * raw) / coverage.commands).toFixed(1)}%); declined: ` +
					JSON.stringify(Object.fromEntries(declined)) +
					`; still raw (inside blocks without syntax yet): ${JSON.stringify(Object.fromEntries(rawHere))}`,
			);
			expect(Object.fromEntries(declined)).toEqual({});
		},
	);
});
