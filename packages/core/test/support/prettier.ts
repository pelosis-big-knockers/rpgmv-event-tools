import { tokenizer, tokTypes as tt, type Token } from "acorn";
import * as prettier from "prettier";
import { expect } from "vitest";
import type { DecompiledScript } from "../../src/index.js";
import { stringWidth } from "../../src/layout.js";

/**
 * Prettier comparisons. The decompiler lays scripts out as Prettier formats them, except the
 * bodies of `script(() => …)` lambdas, which are JavaScript printed exactly as stored. So the
 * comparisons first put a placeholder in each lambda body, then check that Prettier leaves the
 * rest as printed.
 */

/** Formats with this repo's Prettier settings. */
export function format(text: string): Promise<string> {
	return prettier.format(text, { parser: "typescript", useTabs: true, printWidth: 100 });
}

/**
 * Checks that Prettier leaves a script exactly as printed, outside lambda bodies (see
 * {@link forPrettier}).
 */
export async function expectPrettierStable(script: DecompiledScript | string): Promise<void> {
	const text = forPrettier(typeof script === "string" ? script : script.text);
	expect(await format(text)).toBe(text);
}

/**
 * A script that Prettier can compare with its own layout:
 *
 * - The body of each `script(() => …)` and `.script(() => …)` lambda becomes a placeholder that
 *   Prettier keeps as it is and lays out the way the decompiler lays out the body. An expression
 *   body, which the decompiler prints on one line and treats as one unbreakable piece of its
 *   width, becomes an identifier of the same width (`____`). A block body, which always breaks
 *   whatever it holds, becomes a block with the statement `_;`.
 * - Raw strings with text codes aren't valid TypeScript (`\x`, a trailing `\`), so each backslash
 *   in a raw string becomes another one-column character, `§`.
 *
 * The script is read as the script syntax: raw strings end at their first matching quote, `//`
 * comments run to the end of the line, and the arguments of a raw `command(…)` (JavaScript
 * literals) are kept as they are.
 */
export function forPrettier(text: string): string {
	let out = "";
	let copied = 0;
	let index = 0;
	const call = /(?<![\w$.])command\s*\(|(?<![\w$])script\s*\(\s*(?=\(\s*\)\s*=>)/y;
	while (index < text.length) {
		const char = text[index] as string;
		if (text.startsWith("//", index)) {
			const end = text.indexOf("\n", index);
			index = end < 0 ? text.length : end;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			const end = text.indexOf(char, index + 1);
			if (end < 0) {
				throw new Error(`Unterminated string at ${index}`);
			}
			out += text.slice(copied, index) + text.slice(index, end + 1).replaceAll("\\", "§");
			copied = end + 1;
			index = end + 1;
			continue;
		}
		call.lastIndex = index;
		const match = call.exec(text);
		if (!match) {
			index++;
			continue;
		}
		const start = call.lastIndex;
		if (match[0].startsWith("command")) {
			// Skip the arguments up to the closing parenthesis.
			index = argumentsEnd(text, start - 1);
			continue;
		}
		const lambda = lambdaBody(text, start);
		const body = text.slice(lambda.start, lambda.end);
		let placeholder: string;
		if (lambda.block) {
			const lineStart = text.lastIndexOf("\n", lambda.end - 1) + 1;
			const indentation = text.slice(lineStart, lambda.end - 1);
			expect(indentation).toMatch(/^\t*$/);
			placeholder = `{\n${indentation}\t_;\n${indentation}}`;
		} else {
			expect(body).not.toContain("\n");
			placeholder = "_".repeat(stringWidth(body));
		}
		out += text.slice(copied, lambda.start) + placeholder;
		copied = lambda.end;
		index = lambda.end;
	}
	return out + text.slice(copied);
}

/** JavaScript tokens from `offset` on. */
function tokensFrom(text: string, offset: number): Iterator<Token> {
	return tokenizer(text.slice(offset), { ecmaVersion: "latest" })[Symbol.iterator]();
}

const OPENERS = new Set([tt.parenL, tt.bracketL, tt.braceL, tt.dollarBraceL]);
const CLOSERS = new Set([tt.parenR, tt.bracketR, tt.braceR]);

/** The offset just past the parenthesis that closes the one at `open`. */
function argumentsEnd(text: string, open: number): number {
	const tokens = tokensFrom(text, open);
	let depth = 0;
	for (let next = tokens.next(); !next.done; next = tokens.next()) {
		const token = next.value;
		if (OPENERS.has(token.type)) {
			depth++;
		} else if (CLOSERS.has(token.type) && --depth === 0) {
			return open + token.end;
		}
	}
	throw new Error(`Unclosed parenthesis at ${open}`);
}

/**
 * The body of the lambda `() => …` at `offset`: it ends where a `)` or `,` follows it outside any
 * brackets.
 */
function lambdaBody(text: string, offset: number): { start: number; end: number; block: boolean } {
	const tokens = tokensFrom(text, offset);
	const expected = [tt.parenL, tt.parenR, tt.arrow];
	for (const type of expected) {
		expect(tokens.next().value?.type).toBe(type);
	}
	let depth = 0;
	let first: Token | undefined;
	let last: Token | undefined;
	for (let next = tokens.next(); !next.done; next = tokens.next()) {
		const token = next.value;
		if (depth === 0 && (token.type === tt.parenR || token.type === tt.comma)) {
			break;
		}
		if (OPENERS.has(token.type)) {
			depth++;
		} else if (CLOSERS.has(token.type)) {
			depth--;
		}
		first ??= token;
		last = token;
	}
	if (!first || !last) {
		throw new Error(`Empty lambda at ${offset}`);
	}
	return {
		start: offset + first.start,
		end: offset + last.end,
		block: first.type === tt.braceL,
	};
}
