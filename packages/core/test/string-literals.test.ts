import { describe, expect, it } from "vitest";
import { formatStringLiteral, loadProject, parseStringLiteral } from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

/** Formats `text` and checks it parses back to exactly `text`, consuming the whole literal. */
function roundTrip(text: string): string {
	const literal = formatStringLiteral(text);
	expect(parseStringLiteral(literal)).toEqual({ ok: true, value: text, end: literal.length });
	return literal;
}

/** Every string of up to `maxLength` characters drawn from `alphabet`. */
function* allStrings(alphabet: readonly string[], maxLength: number): Generator<string> {
	yield "";
	let previous = [""];
	for (let length = 1; length <= maxLength; length++) {
		const next = previous.flatMap((prefix) => alphabet.map((char) => prefix + char));
		yield* next;
		previous = next;
	}
}

describe("formatStringLiteral", () => {
	it("uses double quotes unless the text contains one", () => {
		expect(formatStringLiteral("Light on")).toBe('"Light on"');
		expect(formatStringLiteral("")).toBe('""');
		expect(formatStringLiteral("Keeper's House")).toBe(`"Keeper's House"`);
	});

	it("falls back to single quotes, then backticks", () => {
		expect(formatStringLiteral('Say "hi"')).toBe(`'Say "hi"'`);
		expect(formatStringLiteral(`"Don't"`)).toBe('`"Don\'t"`');
	});

	it("splits text containing all three delimiters into concatenated pieces", () => {
		expect(formatStringLiteral(`a'b\`c"`)).toBe(`"a'b\`c" + '"'`);
		// Each piece runs until the next character would add a third kind of delimiter.
		expect(formatStringLiteral(`"'\`"'\``)).toBe(`\`"'\` + '\`"' + "'\`"`);
	});

	it("keeps text codes and backslashes raw, with no escapes", () => {
		expect(formatStringLiteral(String.raw`\c[2]Hello\c[0]\{`)).toBe(
			String.raw`"\c[2]Hello\c[0]\{"`,
		);
		expect(formatStringLiteral("ends with \\")).toBe('"ends with \\"');
		expect(formatStringLiteral('\\"')).toBe("'\\\"'");
	});

	it("keeps newlines raw inside the delimiters", () => {
		expect(formatStringLiteral("two\nlines")).toBe('"two\nlines"');
	});
});

describe("parseStringLiteral", () => {
	it("reads a literal at an offset and reports where it ends", () => {
		expect(parseStringLiteral(`say('Hi "you"');`, 4)).toEqual({
			ok: true,
			value: 'Hi "you"',
			end: 14,
		});
	});

	it("joins pieces across + with any spacing", () => {
		expect(parseStringLiteral(`"a"+'b'  +\t\`c\``)).toEqual({ ok: true, value: "abc", end: 14 });
	});

	it("leaves a + that isn't followed by a string to the caller", () => {
		expect(parseStringLiteral(`"a" + x`)).toEqual({ ok: true, value: "a", end: 3 });
		expect(parseStringLiteral(`"a" +`)).toEqual({ ok: true, value: "a", end: 3 });
	});

	it("reports unterminated strings, including a later piece", () => {
		expect(parseStringLiteral(`"abc`)).toEqual({ ok: false, error: "unterminated", start: 0 });
		expect(parseStringLiteral(`"a" + 'b`)).toEqual({ ok: false, error: "unterminated", start: 6 });
	});

	it("returns undefined when there is no string at the offset", () => {
		expect(parseStringLiteral("abc")).toBeUndefined();
		expect(parseStringLiteral('"a"', 3)).toBeUndefined();
	});
});

describe("string literal round trip", () => {
	it("holds for every short string over the tricky characters", () => {
		let count = 0;
		for (const text of allStrings(['"', "'", "`", "\\", "+", " ", "\n", "a"], 5)) {
			roundTrip(text);
			count++;
		}
		expect(count).toBe(37449);
	});

	it("holds for long random strings", () => {
		const alphabet = `"'\`\\+ \n\tabéあ\u{1f600}$\{}`;
		const chars = [...alphabet];
		let seed = 38;
		const random = (): number => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed / 2 ** 31;
		};
		for (let i = 0; i < 2000; i++) {
			const length = Math.floor(random() * 60);
			const text = Array.from({ length }, () => chars[Math.floor(random() * chars.length)]).join(
				"",
			);
			roundTrip(text);
		}
	});

	it("uses a single literal unless the text contains all three delimiters", () => {
		for (const text of allStrings(['"', "'", "`", "a"], 4)) {
			const pieces = roundTrip(text).split(" + ").length;
			const hasAll = ['"', "'", "`"].every((d) => text.includes(d));
			expect(pieces > 1).toBe(hasAll);
		}
	});
});

describeWithGame("string literals in the configured test game", (game) => {
	it("round-trips every string in every command's parameters", async () => {
		const project = await loadProject(game);
		const counts = {
			strings: 0,
			double: 0,
			single: 0,
			backtick: 0,
			split: 0,
			trailingBackslash: 0,
		};
		const visit = (value: unknown): void => {
			if (typeof value === "string") {
				const literal = formatStringLiteral(value);
				const parsed = parseStringLiteral(literal);
				if (!parsed?.ok || parsed.value !== value || parsed.end !== literal.length) {
					throw new Error(`round trip failed for ${JSON.stringify(value)}`);
				}
				counts.strings++;
				if (literal.length > value.length + 2) {
					counts.split++; // more than one pair of delimiters
				} else {
					counts[literal[0] === '"' ? "double" : literal[0] === "'" ? "single" : "backtick"]++;
				}
				if (value.endsWith("\\")) {
					counts.trailingBackslash++;
				}
			} else if (Array.isArray(value)) {
				value.forEach(visit);
			} else if (typeof value === "object" && value !== null) {
				Object.values(value).forEach(visit);
			}
		};
		for await (const { list } of project.commandLists()) {
			for (const command of list) {
				visit(command.parameters);
			}
		}
		console.log("string literals in command parameters:", counts);
		expect(counts.strings).toBeGreaterThan(0);
	});
});
