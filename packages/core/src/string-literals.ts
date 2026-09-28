/**
 * String literals in event scripts.
 *
 * Strings are raw: there are no escape sequences, so MV text codes (`\c[2]`, `\{`, `\v[12]`)
 * and backslashes stay exactly as written, including a trailing backslash. Since nothing can
 * be escaped, the delimiter is picked to be one the text doesn't contain: `"` by default, `'`
 * if the text contains `"`, and `` ` `` if it contains both. Text containing all three is split
 * into pieces that each lack one delimiter, joined with ` + `, for example `"a'b`c" + '"'`.
 *
 * Everything between the delimiters is taken as is, newlines included (names and text lines
 * never contain one, but a string that does still round-trips). A backtick string is not a
 * template: `${` has no special meaning.
 */

/** The string delimiters, in order of preference. */
export const STRING_DELIMITERS = ['"', "'", "`"] as const;
export type StringDelimiter = (typeof STRING_DELIMITERS)[number];

/** Formats `text` as a string literal, which `parseStringLiteral` reads back exactly. */
export function formatStringLiteral(text: string): string {
	const pieces: string[] = [];
	let start = 0;
	let seen = new Set<string>();
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (isStringDelimiter(char) && !seen.has(char)) {
			if (seen.size === STRING_DELIMITERS.length - 1) {
				// This piece already holds the other two delimiters, so it ends here.
				pieces.push(quote(text.slice(start, i), seen));
				start = i;
				seen = new Set();
			}
			seen.add(char);
		}
	}
	pieces.push(quote(text.slice(start), seen));
	return pieces.join(" + ");
}

/** A string literal read by `parseStringLiteral`. */
export type ParsedStringLiteral =
	| { ok: true; value: string; /** Offset just past the literal. */ end: number }
	| {
			ok: false;
			error: "unterminated";
			/** Offset of the opening delimiter that has no closing one. */
			start: number;
	  };

/**
 * Reads the string literal starting at `offset`: one quoted piece, or several joined with `+`
 * (whitespace around the `+` is allowed). A `+` not followed by another string is left for the
 * caller. Returns `undefined` if there is no string delimiter at `offset`.
 */
export function parseStringLiteral(source: string, offset = 0): ParsedStringLiteral | undefined {
	if (!isStringDelimiter(source[offset])) {
		return undefined;
	}
	let value = "";
	let position = offset;
	for (;;) {
		const close = source.indexOf(source[position]!, position + 1);
		if (close < 0) {
			return { ok: false, error: "unterminated", start: position };
		}
		value += source.slice(position + 1, close);
		const end = close + 1;
		const plus = /\s*\+\s*/y;
		plus.lastIndex = end;
		if (!plus.exec(source) || !isStringDelimiter(source[plus.lastIndex])) {
			return { ok: true, value, end };
		}
		position = plus.lastIndex;
	}
}

export function isStringDelimiter(char: string | undefined): char is StringDelimiter {
	return char === '"' || char === "'" || char === "`";
}

/** Quotes a piece with the first delimiter it doesn't contain (`used` lists those it does). */
function quote(piece: string, used: ReadonlySet<string>): string {
	const delimiter = STRING_DELIMITERS.find((d) => !used.has(d))!;
	return delimiter + piece + delimiter;
}
