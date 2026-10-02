import { describe, expect, it } from "vitest";
import {
	createNames,
	createSymbols,
	decompileDocument,
	loadProject,
	type DecompiledScript,
	type EventCommand,
	type ScriptContainer,
} from "../src/index.js";
import { isBlockBody, isExpressionBody } from "../src/javascript.js";
import { hardline, indent, printDoc, verbatim } from "../src/layout.js";
import { expectPrettierStable } from "./support/prettier.js";
import { describeWithGame } from "./support/test-game.js";

describe("isExpressionBody", () => {
	it("accepts one expression with nothing around it", () => {
		const cases = [
			"$gameVariables.value(3) > 2",
			"a",
			"(a)",
			"({ a: 1 })",
			"a ? b : c",
			"async () => 1",
			'$gameMessage.add("}")',
			"/[)]/.test(x)",
			"`a ${b} c`",
			"x = 1",
			"new Foo()",
			"this.jump(0, 0)",
			"a /* inside */ + b",
		];
		for (const code of cases) {
			expect(isExpressionBody(code), code).toBe(true);
		}
	});

	it("rejects anything else", () => {
		const cases = [
			"",
			"a;",
			"a; b",
			"a, b",
			"{}",
			"{ a: 1 }",
			"function f() {}",
			"class A {}",
			"var a = 1",
			" a",
			"a ",
			"a // comment",
			"a /* comment */",
			"/* comment */ a",
			"a\nb",
			"a\r",
			`"${String.fromCharCode(0x2028)}"`,
			"if (",
			"return 1",
			"a)(b",
			"#!x",
		];
		for (const code of cases) {
			expect(isExpressionBody(code), JSON.stringify(code)).toBe(false);
		}
	});
});

describe("isBlockBody", () => {
	it("accepts code that parses and reads back as the same lines", () => {
		const cases = [
			["$gameSystem.disableSave();"],
			["a"],
			[""],
			["", "", ""],
			["  indented();", "\ttabbed();", "   ", "trailing();  "],
			["var s = `one", "two", "  three`;"],
			["var s = 'one\\", "two';"],
			["/* one", "two */"],
			["a(); // comment"],
			["if (a) {", "}"],
			["$gameMessage.add('});');"],
			["{ a: 1 }"],
		];
		for (const lines of cases) {
			expect(isBlockBody(lines), JSON.stringify(lines)).toBe(true);
		}
	});

	it("rejects code that doesn't parse or doesn't read back", () => {
		const cases = [
			["if ("],
			["}); script(() => {"],
			["return 1;"],
			["#!/usr/bin/env node", "a();"],
			["a\nb"],
			["a\r"],
			[`"${String.fromCharCode(0x2029)}"`],
		];
		for (const lines of cases) {
			expect(isBlockBody(lines), JSON.stringify(lines)).toBe(false);
		}
	});
});

describe("verbatim", () => {
	it("keeps trailing whitespace, and prints an empty line empty", () => {
		const doc = [
			"{",
			indent([hardline, verbatim("a  "), hardline, verbatim(""), hardline, verbatim(" ")]),
			hardline,
			"}",
		];
		expect(printDoc(doc)).toBe("{\n\ta  \n\n\t \n}");
	});
});

const cmd = (code: number, indent: number, parameters: unknown[] = []): EventCommand => ({
	code,
	indent,
	parameters,
});

function decompileList(list: EventCommand[]): DecompiledScript {
	const container: ScriptContainer = {
		kind: "commonEvent",
		id: 1,
		commonEvent: { id: 1, name: "Test", trigger: 0, switchId: 1, list: [...list, cmd(0, 0)] },
	};
	const symbols = createSymbols(createNames({ variables: ["", "Day"] }, {}));
	return decompileDocument([container], { symbols });
}

describe("lambda layout", () => {
	it("breaks around a long expression body as Prettier would around an identifier", async () => {
		const long = `$gameVariables.value(${"1".repeat(40)}) + $gameVariables.value(${"2".repeat(40)})`;
		const script = decompileList([
			cmd(111, 0, [12, long]),
			cmd(0, 1),
			cmd(412, 0),
			cmd(111, 0, [12, long.slice(0, 79)]),
			cmd(0, 1),
			cmd(412, 0),
			cmd(122, 0, [1, 1, 0, 4, long]),
			cmd(355, 0, [long]),
		]);
		expect(
			script.text
				.split("\n")
				.slice(3, -2)
				.map((line) => line.slice(1)),
		).toEqual([
			"if (",
			"\tscript(",
			"\t\t() =>",
			`\t\t\t${long},`,
			"\t)",
			") {",
			"}",
			"if (",
			`\tscript(() => ${long.slice(0, 79)})`,
			") {",
			"}",
			"variables.Day = script(",
			"\t() =>",
			`\t\t${long},`,
			");",
			"script(",
			"\t() =>",
			`\t\t${long},`,
			");",
		]);
		await expectPrettierStable(script);
	});
});

/** The forms scripts print in, counted in printed documents or expected from the data. */
interface FormCounts {
	expression: number;
	block: number;
	string: number;
}

/** Counts `script(…)` calls in a printed document by their argument's form. */
function countPrinted(text: string, counts: FormCounts): void {
	// `script(` or a route's `.script(`, but not a plugin command named `script`.
	const call = String.raw`(?<![\w$]|plugin\.)script\(\s*`;
	counts.block += text.match(new RegExp(`${call}\\(\\) => \\{$`, "gm"))?.length ?? 0;
	counts.expression += text.match(new RegExp(`${call}\\(\\) =>(?! \\{$)`, "gm"))?.length ?? 0;
	counts.string += text.match(new RegExp(`${call}["'\`]`, "g"))?.length ?? 0;
}

describeWithGame("scripts on the configured test game", (game) => {
	it(
		"prints every script as a lambda, except code that can't be one",
		{ timeout: 300_000 },
		async () => {
			const project = await loadProject(game);
			const context = { symbols: project.symbols };
			const expected: FormCounts = { expression: 0, block: 0, string: 0 };
			const byCode = new Map<string, number>();
			const add = (code: number, form: keyof FormCounts) => {
				expected[form]++;
				const key = `${code} ${form}`;
				byCode.set(key, (byCode.get(key) ?? 0) + 1);
			};
			const valueForm = (code: unknown) =>
				typeof code === "string" && isExpressionBody(code) ? "expression" : "string";
			for await (const { list } of project.commandLists()) {
				for (let index = 0; index < list.length; index++) {
					const { code, parameters: p } = list[index] as EventCommand;
					if (code === 111 && p[0] === 12) {
						add(code, valueForm(p[1]));
					} else if (code === 122 && p[3] === 4) {
						add(code, valueForm(p[4]));
					} else if (code === 205) {
						const steps = (p[1] as { list: { code: number; parameters?: unknown[] }[] }).list;
						for (const step of steps.filter((entry) => entry.code === 45)) {
							add(45, valueForm(step.parameters?.[0]));
						}
					} else if (code === 355) {
						const lines = [p[0] as string];
						while (list[index + 1]?.code === 655) {
							lines.push((list[++index] as EventCommand).parameters[0] as string);
						}
						const [first] = lines;
						add(
							code,
							lines.length === 1 && isExpressionBody(first as string)
								? "expression"
								: isBlockBody(lines)
									? "block"
									: "string",
						);
					}
				}
			}

			const printed: FormCounts = { expression: 0, block: 0, string: 0 };
			const print = (containers: ScriptContainer[]) =>
				countPrinted(decompileDocument(containers, context).text, printed);
			print(
				project.commonEvents.flatMap((event, id) =>
					event ? [{ kind: "commonEvent" as const, id, commonEvent: event }] : [],
				),
			);
			print(
				project.troops.flatMap((troop, id) =>
					troop ? [{ kind: "troop" as const, id, troop }] : [],
				),
			);
			for (const mapId of project.mapIds()) {
				const map = await project.map(mapId);
				print(
					map.events.flatMap((event, id) =>
						event ? [{ kind: "mapEvent" as const, mapId, id, event, mapEvents: map.events }] : [],
					),
				);
			}
			console.log(
				`scripts: ${[...byCode]
					.sort()
					.map(([key, count]) => `${key} ${count}`)
					.join(", ")}`,
			);
			expect(printed).toEqual(expected);
		},
	);
});
