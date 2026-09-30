/**
 * A small layout engine for printing scripts: a port of the core of Prettier's document printer
 * (a Wadler-style pretty printer). A {@link Doc} describes text with optional line breaks; the
 * printer picks which breaks to take so lines fit the print width.
 *
 * It follows Prettier's algorithm closely, including conditional groups (used to "hug" a last
 * argument) and fill, so scripts built from the same documents Prettier builds come out exactly
 * as Prettier would format them. On top of that, {@link mark}s record which output line a point
 * of the document lands on, which is how source maps are built, and {@link verbatim} text (lines
 * of JavaScript kept as stored) is never trimmed.
 */

export type Doc = string | readonly Doc[] | DocCommand;

type DocCommand = Group | Indent | Line | IfBreak | Fill | BreakParent | Mark | Verbatim;

interface Group {
	readonly type: "group";
	readonly contents: Doc;
	/** Alternative layouts, tried in order (a conditional group). `contents` is the first. */
	readonly expandedStates?: readonly Doc[];
	readonly id?: symbol;
	/** Whether the group must break: set explicitly, or because it contains a hard line. */
	break: boolean;
}

interface Indent {
	readonly type: "indent";
	readonly contents: Doc;
}

interface Line {
	readonly type: "line";
	/** Always breaks. */
	readonly hard?: boolean;
	/** Prints nothing, rather than a space, when not broken. */
	readonly soft?: boolean;
}

interface IfBreak {
	readonly type: "ifBreak";
	readonly breakContents: Doc;
	readonly flatContents: Doc;
	/** Decide by this group's mode rather than the enclosing one. */
	readonly groupId?: symbol;
}

interface Fill {
	readonly type: "fill";
	/** Contents and separators, alternating. */
	readonly parts: readonly Doc[];
}

interface BreakParent {
	readonly type: "breakParent";
}

interface Mark {
	readonly type: "mark";
	/** Called with the 0-based output line the mark is printed on. */
	readonly onPrint: (line: number) => void;
}

/** Text printed exactly as given (see {@link verbatim}). */
interface Verbatim {
	readonly type: "verbatim";
	/** The text, without line breaks. */
	readonly text: string;
}

// Builders, named as in Prettier.

export const line: Doc = { type: "line" };
export const softline: Doc = { type: "line", soft: true };
export const breakParent: Doc = { type: "breakParent" };
export const hardline: Doc = [{ type: "line", hard: true }, breakParent];

export function group(contents: Doc, options: { shouldBreak?: boolean; id?: symbol } = {}): Doc {
	return {
		type: "group",
		contents,
		break: options.shouldBreak ?? false,
		...(options.id === undefined ? {} : { id: options.id }),
	};
}

/** A group that tries each of `states` in turn, taking the first that fits. */
export function conditionalGroup(states: readonly Doc[]): Doc {
	return { type: "group", contents: states[0] ?? "", expandedStates: states, break: false };
}

export function indent(contents: Doc): Doc {
	return { type: "indent", contents };
}

export function ifBreak(breakContents: Doc, flatContents: Doc = "", groupId?: symbol): Doc {
	return {
		type: "ifBreak",
		breakContents,
		flatContents,
		...(groupId === undefined ? {} : { groupId }),
	};
}

/** Indents `contents` only if the group `groupId` breaks. */
export function indentIfBreak(contents: Doc, groupId: symbol): Doc {
	return ifBreak(indent(contents), contents, groupId);
}

export function fill(parts: readonly Doc[]): Doc {
	return { type: "fill", parts };
}

/** A zero-width point that reports the output line it's printed on. */
export function mark(onPrint: (line: number) => void): Doc {
	return { type: "mark", onPrint };
}

/**
 * Text kept exactly as given, such as a line of JavaScript as MV stores it. The printer never
 * trims its trailing whitespace, as it does for other text before a line break. `text` must not
 * contain line breaks. After a hard line it starts at the current indentation, and an empty
 * `text` leaves that line empty. It measures as its width, like other text.
 */
export function verbatim(text: string): Doc {
	return { type: "verbatim", text };
}

export function join(separator: Doc, docs: readonly Doc[]): Doc[] {
	const parts: Doc[] = [];
	docs.forEach((doc, index) => {
		if (index > 0) {
			parts.push(separator);
		}
		parts.push(doc);
	});
	return parts;
}

/** Whether printing `doc` certainly produces a line break (Prettier's `willBreak`). */
export function willBreak(doc: Doc): boolean {
	if (typeof doc === "string") {
		return false;
	}
	if (isDocArray(doc)) {
		return doc.some(willBreak);
	}
	switch (doc.type) {
		case "group":
			return doc.break || willBreak(doc.contents);
		case "indent":
			return willBreak(doc.contents);
		case "ifBreak":
			return willBreak(doc.breakContents) || willBreak(doc.flatContents);
		case "fill":
			return doc.parts.some(willBreak);
		case "line":
			return doc.hard === true;
		case "breakParent":
			return true;
		case "mark":
		case "verbatim":
			return false;
	}
}

/** Whether `doc` has any line that could break (Prettier's `canBreak`). */
export function canBreak(doc: Doc): boolean {
	if (typeof doc === "string") {
		return false;
	}
	if (isDocArray(doc)) {
		return doc.some(canBreak);
	}
	switch (doc.type) {
		case "group":
			return canBreak(doc.contents) || (doc.expandedStates?.some(canBreak) ?? false);
		case "indent":
			return canBreak(doc.contents);
		case "ifBreak":
			return canBreak(doc.breakContents) || canBreak(doc.flatContents);
		case "fill":
			return doc.parts.some(canBreak);
		case "line":
			return true;
		case "breakParent":
		case "mark":
		case "verbatim":
			return false;
	}
}

export interface PrintOptions {
	printWidth: number;
	/** How many columns an indent level counts for when measuring (Prettier's `tabWidth`). */
	tabWidth: number;
}

/** This repo's Prettier settings: tabs, counted as 2 columns, and a 100-column width. */
export const SCRIPT_PRINT_OPTIONS: PrintOptions = { printWidth: 100, tabWidth: 2 };

type Mode = "break" | "flat";

interface IndentState {
	readonly value: string;
	readonly length: number;
}

interface Command {
	readonly indent: IndentState;
	readonly mode: Mode;
	readonly doc: Doc;
}

/** Prints `doc` with tabs for indentation. Lines end with `\n`. */
export function printDoc(doc: Doc, options: PrintOptions = SCRIPT_PRINT_OPTIONS): string {
	propagateBreaks(doc);
	const width = options.printWidth;
	const groupModes = new Map<symbol, Mode>();
	const out: string[] = [];
	const commands: Command[] = [{ indent: { value: "", length: 0 }, mode: "break", doc }];
	let position = 0;
	let lineNumber = 0;
	let shouldRemeasure = false;
	/** How many entries at the start of `out` are never trimmed: up to the last verbatim text. */
	let kept = 0;

	while (commands.length > 0) {
		const { indent: ind, mode, doc: current } = commands.pop() as Command;
		if (typeof current === "string") {
			out.push(current);
			position += stringWidth(current);
			continue;
		}
		if (isDocArray(current)) {
			for (let i = current.length - 1; i >= 0; i--) {
				commands.push({ indent: ind, mode, doc: current[i] as Doc });
			}
			continue;
		}
		switch (current.type) {
			case "indent":
				commands.push({
					indent: { value: `${ind.value}\t`, length: ind.length + options.tabWidth },
					mode,
					doc: current.contents,
				});
				break;
			case "group": {
				if (mode === "flat" && !shouldRemeasure) {
					commands.push({
						indent: ind,
						mode: current.break ? "break" : "flat",
						doc: current.contents,
					});
				} else {
					shouldRemeasure = false;
					const next: Command = { indent: ind, mode: "flat", doc: current.contents };
					const remaining = width - position;
					if (!current.break && fits(next, commands, remaining, groupModes, false)) {
						commands.push(next);
					} else if (current.expandedStates) {
						const mostExpanded = current.expandedStates.at(-1) as Doc;
						if (current.break) {
							commands.push({ indent: ind, mode: "break", doc: mostExpanded });
						} else {
							for (let i = 1; i < current.expandedStates.length + 1; i++) {
								if (i >= current.expandedStates.length) {
									commands.push({ indent: ind, mode: "break", doc: mostExpanded });
									break;
								}
								const state: Command = {
									indent: ind,
									mode: "flat",
									doc: current.expandedStates[i] as Doc,
								};
								if (fits(state, commands, remaining, groupModes, false)) {
									commands.push(state);
									break;
								}
							}
						}
					} else {
						commands.push({ indent: ind, mode: "break", doc: current.contents });
					}
				}
				if (current.id) {
					groupModes.set(current.id, (commands.at(-1) as Command).mode);
				}
				break;
			}
			case "fill": {
				const remaining = width - position;
				const [content, whitespace] = current.parts;
				if (content === undefined) {
					break;
				}
				const contentFlat: Command = { indent: ind, mode: "flat", doc: content };
				const contentBreak: Command = { indent: ind, mode: "break", doc: content };
				const contentFits = fits(contentFlat, [], remaining, groupModes, true);
				if (whitespace === undefined) {
					commands.push(contentFits ? contentFlat : contentBreak);
					break;
				}
				const whitespaceFlat: Command = { indent: ind, mode: "flat", doc: whitespace };
				const whitespaceBreak: Command = { indent: ind, mode: "break", doc: whitespace };
				if (current.parts.length === 2) {
					commands.push(
						...(contentFits ? [whitespaceFlat, contentFlat] : [whitespaceBreak, contentBreak]),
					);
					break;
				}
				const rest: Command = { indent: ind, mode, doc: fill(current.parts.slice(2)) };
				const secondContent = current.parts[2] as Doc;
				const bothFit = fits(
					{ indent: ind, mode: "flat", doc: [content, whitespace, secondContent] },
					[],
					remaining,
					groupModes,
					true,
				);
				if (bothFit) {
					commands.push(rest, whitespaceFlat, contentFlat);
				} else if (contentFits) {
					commands.push(rest, whitespaceBreak, contentFlat);
				} else {
					commands.push(rest, whitespaceBreak, contentBreak);
				}
				break;
			}
			case "ifBreak": {
				const groupMode = current.groupId ? (groupModes.get(current.groupId) ?? "flat") : mode;
				const contents = groupMode === "break" ? current.breakContents : current.flatContents;
				commands.push({ indent: ind, mode, doc: contents });
				break;
			}
			case "line":
				if (mode === "flat" && !current.hard) {
					if (!current.soft) {
						out.push(" ");
						position += 1;
					}
					break;
				}
				if (mode === "flat") {
					shouldRemeasure = true;
				}
				trimTrailingWhitespace(out, kept);
				out.push(`\n${ind.value}`);
				position = ind.length;
				lineNumber++;
				break;
			case "breakParent":
				break;
			case "mark":
				current.onPrint(lineNumber);
				break;
			case "verbatim":
				if (current.text !== "") {
					out.push(current.text);
					position += stringWidth(current.text);
					kept = out.length;
				}
				break;
		}
	}
	return out.join("");
}

/**
 * Whether `next` fits in `width` columns, measured up to its first line break. When `next` runs
 * out, the commands after it (`rest`, from the top of the stack) are measured too.
 */
function fits(
	next: Command,
	rest: readonly Command[],
	width: number,
	groupModes: ReadonlyMap<symbol, Mode>,
	mustBeFlat: boolean,
): boolean {
	let restIndex = rest.length;
	const pending: { mode: Mode; doc: Doc }[] = [next];
	let remaining = width;
	while (remaining >= 0) {
		const item = pending.pop();
		if (!item) {
			if (restIndex === 0) {
				return true;
			}
			pending.push(rest[--restIndex] as Command);
			continue;
		}
		const { mode, doc } = item;
		if (typeof doc === "string") {
			remaining -= stringWidth(doc);
			continue;
		}
		if (isDocArray(doc)) {
			for (let i = doc.length - 1; i >= 0; i--) {
				pending.push({ mode, doc: doc[i] as Doc });
			}
			continue;
		}
		switch (doc.type) {
			case "indent":
				pending.push({ mode, doc: doc.contents });
				break;
			case "fill":
				for (let i = doc.parts.length - 1; i >= 0; i--) {
					pending.push({ mode, doc: doc.parts[i] as Doc });
				}
				break;
			case "group": {
				if (mustBeFlat && doc.break) {
					return false;
				}
				const groupMode: Mode = doc.break ? "break" : mode;
				const contents =
					doc.expandedStates && groupMode === "break"
						? (doc.expandedStates.at(-1) as Doc)
						: doc.contents;
				pending.push({ mode: groupMode, doc: contents });
				break;
			}
			case "ifBreak": {
				const groupMode = doc.groupId ? (groupModes.get(doc.groupId) ?? "flat") : mode;
				pending.push({
					mode,
					doc: groupMode === "break" ? doc.breakContents : doc.flatContents,
				});
				break;
			}
			case "line":
				if (mode === "break" || doc.hard) {
					return true;
				}
				if (!doc.soft) {
					remaining--;
				}
				break;
			case "verbatim":
				remaining -= stringWidth(doc.text);
				break;
			case "breakParent":
			case "mark":
				break;
		}
	}
	return false;
}

/**
 * Marks every group that contains a hard line as broken, as Prettier does before printing.
 * Conditional groups aren't marked, and don't pass the break on to their parents.
 */
function propagateBreaks(doc: Doc): void {
	const visited = new Set<Group>();
	const visit = (current: Doc): boolean => {
		if (typeof current === "string") {
			return false;
		}
		if (isDocArray(current)) {
			let found = false;
			for (const child of current) {
				found = visit(child) || found;
			}
			return found;
		}
		switch (current.type) {
			case "group": {
				if (visited.has(current)) {
					return current.break;
				}
				visited.add(current);
				if (current.expandedStates) {
					for (const state of current.expandedStates) {
						visit(state);
					}
				} else if (visit(current.contents)) {
					current.break = true;
				}
				return current.break;
			}
			case "indent":
				return visit(current.contents);
			case "ifBreak": {
				const inBreak = visit(current.breakContents);
				return visit(current.flatContents) || inBreak;
			}
			case "fill": {
				let found = false;
				for (const part of current.parts) {
					found = visit(part) || found;
				}
				return found;
			}
			case "breakParent":
				return true;
			case "line":
			case "mark":
			case "verbatim":
				return false;
		}
	};
	visit(doc);
}

/** Trims spaces and tabs from the end of `out`, leaving its first `kept` entries as they are. */
function trimTrailingWhitespace(out: string[], kept: number): void {
	while (out.length > kept) {
		const trimmed = (out[out.length - 1] as string).replace(/[ \t]+$/, "");
		if (trimmed.length > 0) {
			out[out.length - 1] = trimmed;
			return;
		}
		out.pop();
	}
}

function isDocArray(doc: Doc): doc is readonly Doc[] {
	return Array.isArray(doc);
}

/**
 * The columns `text` takes, as Prettier counts them: East Asian wide and fullwidth characters
 * count 2, and control characters and combining marks count 0.
 */
export function stringWidth(text: string): number {
	if (!/[^\x20-\x7e]/.test(text)) {
		return text.length;
	}
	let width = 0;
	for (const char of text) {
		const code = char.codePointAt(0) as number;
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x300 && code <= 0x36f)) {
			continue;
		}
		width += isWide(code) ? 2 : 1;
	}
	return width;
}

/** East Asian Wide and Fullwidth ranges (the common ones), plus emoji. */
function isWide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0x303e) ||
		(code >= 0x3041 && code <= 0x33ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xa000 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1f64f) ||
		(code >= 0x1f900 && code <= 0x1f9ff) ||
		(code >= 0x20000 && code <= 0x3fffd)
	);
}
