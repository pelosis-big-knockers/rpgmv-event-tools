import { describe, expect, it } from "vitest";
import {
	TEXT_CODES,
	describeTextCode,
	getTextCodeInfo,
	joinTextTokens,
	loadProject,
	tokenizeText,
	type TextCodeToken,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

/** Tokens as `[kind or "text", source]` pairs, for compact expectations. */
function shape(text: string): [string, string][] {
	return tokenizeText(text).map((token) => [
		token.type === "text" ? "text" : token.kind,
		token.text,
	]);
}

function codes(text: string): TextCodeToken[] {
	return tokenizeText(text).filter((token) => token.type === "code");
}

describe("tokenizeText", () => {
	it("returns plain text as one token, and nothing for an empty string", () => {
		expect(tokenizeText("Hello there.")).toEqual([
			{ type: "text", text: "Hello there.", offset: 0 },
		]);
		expect(tokenizeText("")).toEqual([]);
	});

	it("recognizes every core code", () => {
		expect(shape("\\c[2]\\i[5]\\v[12]\\N[1]\\p[1]\\G\\{\\}")).toEqual([
			["color", "\\c[2]"],
			["icon", "\\i[5]"],
			["variable", "\\v[12]"],
			["actorName", "\\N[1]"],
			["partyMemberName", "\\p[1]"],
			["currencyUnit", "\\G"],
			["fontBigger", "\\{"],
			["fontSmaller", "\\}"],
		]);
		expect(shape("\\$\\.\\|\\!\\>\\<\\^\\\\")).toEqual([
			["showGold", "\\$"],
			["shortWait", "\\."],
			["longWait", "\\|"],
			["waitForInput", "\\!"],
			["instantOn", "\\>"],
			["instantOff", "\\<"],
			["skipInputWait", "\\^"],
			["backslash", "\\\\"],
		]);
	});

	it("records offsets, names and arguments as written", () => {
		expect(tokenizeText("Hi \\N[1], you owe \\v[03]\\g.")).toEqual([
			{ type: "text", text: "Hi ", offset: 0 },
			{ type: "code", text: "\\N[1]", offset: 3, kind: "actorName", name: "N", argument: "1" },
			{ type: "text", text: ", you owe ", offset: 8 },
			{ type: "code", text: "\\v[03]", offset: 18, kind: "variable", name: "v", argument: "03" },
			{ type: "code", text: "\\g", offset: 24, kind: "currencyUnit", name: "g" },
			{ type: "text", text: ".", offset: 26 },
		]);
	});

	it("reads \\n as the actor name code, never as a newline", () => {
		expect(shape("\\n[1] and \\N[1]")).toEqual([
			["actorName", "\\n[1]"],
			["text", " and "],
			["actorName", "\\N[1]"],
		]);
	});

	it("reads \\\\ as a literal backslash before anything else", () => {
		expect(shape("a\\\\c[1]")).toEqual([
			["text", "a"],
			["backslash", "\\\\"],
			["text", "c[1]"],
		]);
		expect(shape("\\\\\\c[1]")).toEqual([
			["backslash", "\\\\"],
			["color", "\\c[1]"],
		]);
	});

	it("reads a run of letters as one code, as the engine does", () => {
		expect(codes("\\fs[20]big\\FB").map((c) => [c.kind, c.name, c.argument])).toEqual([
			["unknown", "fs", "20"],
			["unknown", "FB", undefined],
		]);
		expect(shape("\\ci[2]")).toEqual([["unknown", "\\ci[2]"]]);
	});

	it("treats \\G as the currency unit even when letters follow", () => {
		expect(shape("50\\Gold")).toEqual([
			["text", "50"],
			["currencyUnit", "\\G"],
			["text", "old"],
		]);
	});

	it("marks core letter codes without a numeric argument as unknown", () => {
		expect(shape("\\c")).toEqual([["unknown", "\\c"]]);
		expect(shape("\\c[x]")).toEqual([["unknown", "\\c[x]"]]);
		expect(shape("\\v[]")).toEqual([["unknown", "\\v[]"]]);
		expect(shape("\\v [1]")).toEqual([
			["unknown", "\\v"],
			["text", " [1]"],
		]);
	});

	it("recognizes plugin codes with any bracketed argument, and other symbols", () => {
		expect(shape("\\oc[#ff0000]\\n<Name>\\*")).toEqual([
			["unknown", "\\oc[#ff0000]"],
			["unknown", "\\n"],
			["text", "<Name>"],
			["unknown", "\\*"],
		]);
	});

	it("keeps a stray backslash as its own token", () => {
		expect(shape("Wait...\\")).toEqual([
			["text", "Wait..."],
			["stray", "\\"],
		]);
		expect(shape("\\1\\ \\é")).toEqual([
			["stray", "\\"],
			["text", "1"],
			["stray", "\\"],
			["text", " "],
			["stray", "\\"],
			["text", "é"],
		]);
	});

	it("does not treat brackets as part of an argument when they don't close", () => {
		expect(shape("\\c[2\\i[3]")).toEqual([
			["unknown", "\\c"],
			["text", "[2"],
			["icon", "\\i[3]"],
		]);
	});

	it("joins back to the original text", () => {
		for (const text of [
			"",
			"plain",
			"\\",
			"\\\\\\",
			"\"Quoted\\.\" \\c[2]red\\c[0] 'single' `tick`",
			"\\>\\i[76]\\}TITLE\\{\\<",
			"\\V[\\V[1]]",
			"\\c[2\\i[3]\\x[a]b]",
		]) {
			expect(joinTextTokens(tokenizeText(text))).toBe(text);
		}
	});
});

describe("text code catalog", () => {
	it("has one entry per kind, and none for unknown or stray codes", () => {
		const kinds = TEXT_CODES.map((entry) => entry.kind);
		expect(new Set(kinds).size).toBe(kinds.length);
		expect(getTextCodeInfo("color")).toMatchObject({ code: "C", hasArgument: true });
		expect(getTextCodeInfo("longWait")).toMatchObject({ code: "|", messageOnly: true });
		expect(getTextCodeInfo("unknown")).toBeUndefined();
		expect(getTextCodeInfo("stray")).toBeUndefined();
	});

	it("describes codes for hovers", () => {
		const [color, wait, plugin, stray] = codes("\\c[02]\\.\\fs[20]\\");
		expect(describeTextCode(color!)).toBe(
			"Text color 2: Changes the text color (0 is the normal color).",
		);
		expect(describeTextCode(wait!)).toBe(
			"Wait 1/4 second: Waits 15 frames. Only works in Show Text.",
		);
		expect(describeTextCode(plugin!)).toMatch(/\\fs, which the core engine doesn't define/);
		expect(describeTextCode(stray!)).toMatch(/starts no text code/);
	});
});

/** Show Text and its lines, Show Choices and When, and Show Scrolling Text lines. */
const MESSAGE_CODES = new Set([101, 401, 102, 402, 405]);

describeWithGame("text codes in the configured test game", (game) => {
	it(
		"tokenizes every message string and joins it back byte for byte",
		{ timeout: 60_000 },
		async () => {
			const project = await loadProject(game);
			const counts = new Map<string, number>();
			const mismatches: string[] = [];
			let strings = 0;
			for await (const { list } of project.commandLists()) {
				for (const { code, parameters } of list) {
					if (!MESSAGE_CODES.has(code)) {
						continue;
					}
					for (const text of messageStrings(parameters)) {
						strings++;
						const tokens = tokenizeText(text);
						if (joinTextTokens(tokens) !== text) {
							mismatches.push(text);
						}
						for (const token of tokens) {
							if (token.type === "code") {
								const key = `${token.kind} \\${token.name}`;
								counts.set(key, (counts.get(key) ?? 0) + 1);
							}
						}
					}
				}
			}
			expect(strings).toBeGreaterThan(0);
			expect(mismatches).toEqual([]);

			// Report which codes the game uses, most frequent first.
			const report = [...counts].sort((a, b) => b[1] - a[1]);
			console.log(
				`Text codes in ${strings} strings:\n` +
					report.map(([key, n]) => `  ${key}: ${n}`).join("\n"),
			);
		},
	);
});

/** Every string in a command's parameters, including the choice texts of Show Choices. */
function messageStrings(parameters: unknown[]): string[] {
	return parameters.flat().filter((value) => typeof value === "string");
}
