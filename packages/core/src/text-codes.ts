/**
 * MV text codes: the backslash sequences in message text, such as `\c[2]` (text color) or
 * `\N[1]` (an actor's name). The script keeps them exactly as written; this module splits a
 * string into plain text and codes so that editor features can explain each code.
 *
 * Semantics follow `Window_Base.convertEscapeCharacters`, `obtainEscapeCode` and
 * `processEscapeCharacter`, and `Window_Message.processEscapeCharacter`, in MV's
 * `rpg_windows.js` (v1.6):
 *
 * - `\\` is a literal backslash, and is read before anything else.
 * - A code is a backslash followed by one symbol, or by a run of ASCII letters. Letters are
 *   case-insensitive (`\n[1]` and `\N[1]` are the same code). Core codes take a numeric
 *   argument in brackets: `\c[2]`.
 * - `\G` is replaced wherever it appears, even when more letters follow (`\Gold` is the currency
 *   unit followed by `old`).
 * - A backslash followed by anything else (a digit, a space, the end of the text) starts no code.
 *   The game skips it.
 *
 * Plugins add their own codes (for example `\fs[20]`). They are recognized by shape, with any
 * bracketed argument, and have the kind `unknown`.
 */

/** What a text code does. `unknown` is a code the core engine doesn't define. */
export type TextCodeKind =
	| "backslash"
	| "variable"
	| "actorName"
	| "partyMemberName"
	| "currencyUnit"
	| "color"
	| "icon"
	| "fontBigger"
	| "fontSmaller"
	| "showGold"
	| "shortWait"
	| "longWait"
	| "waitForInput"
	| "instantOn"
	| "instantOff"
	| "skipInputWait"
	| "unknown"
	/** A backslash that starts no code. The game skips it. */
	| "stray";

/** A text code the core engine defines. */
export interface TextCodeInfo {
	kind: TextCodeKind;
	/** The code in upper case, without the backslash: `C`, `{`, `\`. */
	code: string;
	/** Whether the code takes a numeric argument in brackets, as in `\C[2]`. */
	hasArgument: boolean;
	/** A short name, for example `Text color`. */
	label: string;
	/** What the code does. */
	description: string;
	/** Whether the code only works in Show Text messages (not in choices or other windows). */
	messageOnly: boolean;
}

/** Plain text, shown as it is. */
export interface PlainTextToken {
	type: "text";
	/** The exact source text. */
	text: string;
	/** Position of `text` in the tokenized string. */
	offset: number;
}

/** A text code, including its backslash and any argument. */
export interface TextCodeToken {
	type: "code";
	/** The exact source text, for example `\v[03]`. */
	text: string;
	/** Position of `text` in the tokenized string. */
	offset: number;
	kind: TextCodeKind;
	/** The letters or symbol after the backslash, as written (`v`, `N`, `{`). Empty for `stray`. */
	name: string;
	/** What is between the brackets, as written (`03`), or `undefined` if there are none. */
	argument?: string;
}

export type TextToken = PlainTextToken | TextCodeToken;

function info(
	kind: TextCodeKind,
	code: string,
	label: string,
	description: string,
	{ hasArgument = false, messageOnly = false } = {},
): TextCodeInfo {
	return { kind, code, hasArgument, label, description, messageOnly };
}

const ARG = { hasArgument: true };
const MESSAGE = { messageOnly: true };

/** Every text code the core engine defines. */
export const TEXT_CODES: readonly TextCodeInfo[] = [
	info("backslash", "\\", "Backslash", "A literal backslash."),
	info("variable", "V", "Variable", "The value of a variable.", ARG),
	info("actorName", "N", "Actor name", "The name of an actor.", ARG),
	info(
		"partyMemberName",
		"P",
		"Party member name",
		"The name of a party member, by position (1 is the leader).",
		ARG,
	),
	info("currencyUnit", "G", "Currency unit", "The currency unit set in the database."),
	info("color", "C", "Text color", "Changes the text color (0 is the normal color).", ARG),
	info("icon", "I", "Icon", "Draws an icon.", ARG),
	info("fontBigger", "{", "Bigger text", "Makes the text 12 pixels bigger."),
	info("fontSmaller", "}", "Smaller text", "Makes the text 12 pixels smaller."),
	info("showGold", "$", "Show gold", "Opens the gold window.", MESSAGE),
	info("shortWait", ".", "Wait 1/4 second", "Waits 15 frames.", MESSAGE),
	info("longWait", "|", "Wait 1 second", "Waits 60 frames.", MESSAGE),
	info("waitForInput", "!", "Wait for input", "Waits for the player to press a button.", MESSAGE),
	info("instantOn", ">", "Show line at once", "Shows the rest of the line at once.", MESSAGE),
	info("instantOff", "<", "Stop showing at once", "Ends the effect of `\\>`.", MESSAGE),
	info(
		"skipInputWait",
		"^",
		"Don't wait for input",
		"Closes the message without waiting for input.",
		MESSAGE,
	),
];

const BY_CODE = new Map(TEXT_CODES.map((entry) => [entry.code, entry]));
const BY_KIND = new Map(TEXT_CODES.map((entry) => [entry.kind, entry]));

/**
 * `\\`, then `\G` (which the engine replaces even inside a longer run of letters), then letter
 * codes with an optional bracketed argument, then one-symbol codes, then a stray backslash.
 */
const CODE = /\\(?:(\\)|([Gg])|([A-Za-z]+)(?:\[([^[\]\\]*)\])?|([!-/:-@[-`{-~])|)/y;

/** Splits message text into plain text and text codes. Joining the tokens gives back `text`. */
export function tokenizeText(text: string): TextToken[] {
	const tokens: TextToken[] = [];
	let plainStart = 0;
	let index = text.indexOf("\\");
	while (index !== -1) {
		if (index > plainStart) {
			tokens.push({ type: "text", text: text.slice(plainStart, index), offset: plainStart });
		}
		CODE.lastIndex = index;
		// The final alternative is empty, so this always matches at a backslash.
		const match = CODE.exec(text)!;
		tokens.push(codeToken(match, index));
		plainStart = index + match[0].length;
		index = text.indexOf("\\", plainStart);
	}
	if (plainStart < text.length) {
		tokens.push({ type: "text", text: text.slice(plainStart), offset: plainStart });
	}
	return tokens;
}

function codeToken(match: RegExpExecArray, offset: number): TextCodeToken {
	const [text, backslash, currency, letters, argument, symbol] = match;
	const token = (kind: TextCodeKind, name: string): TextCodeToken => ({
		type: "code",
		text,
		offset,
		kind,
		name,
		...(argument === undefined ? {} : { argument }),
	});
	if (backslash !== undefined) {
		return token("backslash", backslash);
	}
	if (currency !== undefined) {
		return token("currencyUnit", currency);
	}
	if (letters !== undefined) {
		const known = BY_CODE.get(letters.toUpperCase());
		const matches = known?.hasArgument && argument !== undefined && /^\d+$/.test(argument);
		return token(matches ? known.kind : "unknown", letters);
	}
	if (symbol !== undefined) {
		return token(BY_CODE.get(symbol)?.kind ?? "unknown", symbol);
	}
	return token("stray", "");
}

/** Joins tokens back into a string. */
export function joinTextTokens(tokens: readonly TextToken[]): string {
	return tokens.map((token) => token.text).join("");
}

/** The catalog entry for a kind of text code, or `undefined` for `unknown` and `stray`. */
export function getTextCodeInfo(kind: TextCodeKind): TextCodeInfo | undefined {
	return BY_KIND.get(kind);
}

/** A one-line explanation of a text code, for hovers. */
export function describeTextCode(token: TextCodeToken): string {
	const known = BY_KIND.get(token.kind);
	if (known) {
		const n = token.argument === undefined ? "" : ` ${Number(token.argument)}`;
		const where = known.messageOnly ? " Only works in Show Text." : "";
		return `${known.label}${n}: ${known.description}${where}`;
	}
	if (token.kind === "stray") {
		return "A backslash that starts no text code. The game skips it.";
	}
	return `Text code \\${token.name}, which the core engine doesn't define (usually from a plugin).`;
}
