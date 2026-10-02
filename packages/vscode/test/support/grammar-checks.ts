import { tokenizeText } from "../../../core/src/index.js";
import type { Token } from "./textmate.js";

/** A text code as highlighted: its position in the string, its text and whether it's unknown. */
export interface HighlightedCode {
	offset: number;
	text: string;
	unknown: boolean;
}

const RAW_STRING = /^string\.quoted\.[a-z.]+\.rpgmv-script$/;
const TEXT_CODE = "constant.character.escape.text-code.rpgmv-script";
const UNKNOWN_CODE = "constant.character.escape.text-code.unknown.rpgmv-script";
const LAMBDA = "meta.script-lambda.rpgmv-script";

const isBegin = (token: Token) =>
	token.scopes.includes("punctuation.definition.string.begin.rpgmv-script");
const isEnd = (token: Token) =>
	token.scopes.includes("punctuation.definition.string.end.rpgmv-script");

/** The text codes the grammar highlights in a string, from the tokens between its quotes. */
export function highlightedCodes(content: readonly Token[]): HighlightedCode[] {
	const codes: HighlightedCode[] = [];
	let offset = 0;
	for (const token of content) {
		const unknown = token.scopes.includes(UNKNOWN_CODE);
		if (unknown || token.scopes.includes(TEXT_CODE)) {
			codes.push({ offset, text: token.text, unknown });
		}
		offset += token.text.length;
	}
	return codes;
}

/** The text codes `tokenizeText` finds in a string, in the same form. */
export function expectedCodes(text: string): HighlightedCode[] {
	return tokenizeText(text).flatMap((token) =>
		token.type === "code" && token.kind !== "stray"
			? [{ offset: token.offset, text: token.text, unknown: token.kind === "unknown" }]
			: [],
	);
}

/**
 * Checks a tokenized document for signs that a string was read wrongly, and returns a message
 * for each problem found:
 *
 * - every raw string closes on its own line, and its text codes are the ones `tokenizeText` finds;
 * - no TypeScript string starts outside a raw-fallback `command(…)`, a `script(() => …)` lambda
 *   (JavaScript) or a comment (the injection missed a string there), no raw string starts inside
 *   a lambda (the injection went into JavaScript), and nothing is marked invalid;
 * - the document ends back at the top level, so no rule was left open.
 */
export function checkDocument(lines: readonly (readonly Token[])[]): string[] {
	const problems: string[] = [];
	lines.forEach((tokens, index) => {
		const where = `line ${index + 1}`;
		let open: { at: number } | undefined;
		tokens.forEach((token, at) => {
			const scopes = token.scopes;
			if (scopes.some((scope) => scope.startsWith("invalid"))) {
				problems.push(`${where}: invalid token ${JSON.stringify(token.text)}`);
			}
			const tsString = scopes.some((scope) => /^string\..*\.ts$/.test(scope));
			const lambda = scopes.includes(LAMBDA);
			const allowed = scopes.some(
				(scope) => scope.startsWith("meta.raw-fallback-arguments") || scope.startsWith("comment"),
			);
			if (tsString && !allowed && !lambda) {
				problems.push(`${where}: TypeScript string ${JSON.stringify(token.text)}`);
			}
			if (lambda && scopes.some((scope) => RAW_STRING.test(scope))) {
				problems.push(`${where}: raw string ${JSON.stringify(token.text)} in a lambda`);
			}
			if (isBegin(token) && !open) {
				open = { at };
			} else if (isEnd(token) && open) {
				const content = tokens.slice(open.at + 1, at);
				const text = content.map((t) => t.text).join("");
				const actual = highlightedCodes(content);
				const expected = expectedCodes(text);
				if (JSON.stringify(actual) !== JSON.stringify(expected)) {
					problems.push(`${where}: text codes of ${JSON.stringify(text)} differ from tokenizeText`);
				}
				open = undefined;
			} else if (!open && scopes.some((scope) => RAW_STRING.test(scope))) {
				problems.push(`${where}: string text ${JSON.stringify(token.text)} outside quotes`);
			}
		});
		if (open) {
			problems.push(`${where}: a string doesn't close`);
		}
	});
	const last = lines.at(-1)?.[0];
	if (last && last.scopes.join(" ") !== "source.rpgmv-script") {
		problems.push(`the document ends inside ${last.scopes.join(" ")}`);
	}
	return problems;
}
