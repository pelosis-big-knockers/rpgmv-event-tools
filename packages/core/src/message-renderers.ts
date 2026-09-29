/**
 * Renderers for messages, comments, scripts and plugin commands (spec section 8.2, #42): Show
 * Text, Show Choices, Input Number, Select Item, Show Scrolling Text, comments, scripts and
 * plugin commands.
 *
 * Each renderer prints a command only when its parameters are exactly what the syntax
 * reproduces (their count and types included), and otherwise declines so the raw fallback keeps
 * the command as it is.
 */
import type { EventCommand } from "./commands.js";
import { hardline, join, type Doc } from "./layout.js";
import type { CommandRenderer, RenderContext } from "./renderers.js";
import {
	arrayLiteral,
	arrowBlock,
	booleanLiteral,
	call,
	identifier,
	methodCall,
	numberLiteral,
	objectLiteral,
	scriptString,
	statement,
	symbolReference,
	type Expr,
} from "./script-docs.js";
import { nameOf } from "./script-terms.js";
import type { BlockBranch, CommandNode } from "./structure.js";
import { isIdentifierName } from "./symbols.js";

/** Message window backgrounds, for Show Text and Show Choices. */
const BACKGROUNDS: Record<number, string> = { 0: "window", 1: "dim", 2: "transparent" };
const TEXT_POSITIONS: Record<number, string> = { 0: "top", 1: "middle", 2: "bottom" };
const CHOICE_POSITIONS: Record<number, string> = { 0: "left", 1: "middle", 2: "right" };
const ITEM_TYPES: Record<number, string> = {
	1: "regularItem",
	2: "keyItem",
	3: "hiddenItemA",
	4: "hiddenItemB",
};
/** Show Choices cancel types with a name: disallow cancel, or run the When Cancel branch. */
const CANCEL_TYPES: Record<number, string> = { [-1]: "disallow", [-2]: "branch" };

/** The parameters of the command at `index`. */
function params(context: RenderContext, index: number): unknown[] {
	return context.list[index]?.parameters ?? [];
}

/** An integer, not `-0` (which would print as `0`). */
function isInteger(value: unknown): value is number {
	return Number.isInteger(value) && !Object.is(value, -0);
}

function isIndex(value: unknown): value is number {
	return isInteger(value) && value >= 0;
}

/** Text a script string can hold: a string without line breaks (see spec 4.4). */
function isText(value: unknown): value is string {
	return typeof value === "string" && !/[\r\n]/.test(value);
}

/**
 * The texts of a command and its continuation lines (a Show Text's 401 lines, a script's 655
 * lines, …), each stored as the only parameter, or `undefined` if one isn't text. `first` is the
 * index of the first command whose text counts.
 */
function lineTexts(
	node: { start: number; end: number },
	context: RenderContext,
	first = node.start,
): string[] | undefined {
	const texts: string[] = [];
	for (let index = first; index < node.end; index++) {
		const p = params(context, index);
		const [text] = p;
		if (p.length !== 1 || !isText(text)) {
			return undefined;
		}
		texts.push(text);
	}
	return texts;
}

/** Options with their values, leaving out those at their default (`undefined`). */
function options(entries: readonly (readonly [string, Expr | undefined])[]): [string, Expr][] {
	return entries.filter((entry): entry is [string, Expr] => entry[1] !== undefined);
}

/** An enum value's name, or `undefined` when it is the default, or `null` when it has none. */
function option(
	names: Readonly<Record<number, string>>,
	value: unknown,
	defaultValue: number,
): Expr | undefined | null {
	const name = nameOf(names, value);
	if (name === undefined) {
		return null;
	}
	return value === defaultValue ? undefined : scriptString(name);
}

/** `name({ opts }, "line", …)`, without the options object when it is empty. */
function linesCall(name: string, opts: readonly [string, Expr][], lines: readonly string[]): Doc {
	const args = lines.map(scriptString);
	return statement(call(name, opts.length > 0 ? [objectLiteral(opts), ...args] : args));
}

/** 101 + 401: `showText({ face, faceIndex, background, position }, "line", …);`. */
const showText: CommandRenderer = (node, context) => {
	const p = params(context, node.start);
	const [face, faceIndex, background, position] = p;
	const lines = lineTexts(node, context, node.start + 1);
	const backgroundOption = option(BACKGROUNDS, background, 0);
	const positionOption = option(TEXT_POSITIONS, position, 2);
	if (
		node.kind !== "command" ||
		p.length !== 4 ||
		!isText(face) ||
		!isIndex(faceIndex) ||
		backgroundOption === null ||
		positionOption === null ||
		!lines
	) {
		return undefined;
	}
	const opts = options([
		["face", face === "" ? undefined : scriptString(face)],
		["faceIndex", faceIndex === 0 ? undefined : numberLiteral(faceIndex)],
		["background", backgroundOption],
		["position", positionOption],
	]);
	return linesCall("showText", opts, lines);
};

/**
 * 102 / 402 / 403 / 404: `showChoices([choice("text", () => { … }), …], { cancel, … });`, with
 * the When Cancel branch as `onCancel`.
 */
const showChoices: CommandRenderer = (node, context) => {
	if (node.kind !== "block") {
		return undefined;
	}
	const p = params(context, node.start);
	const [texts, cancelType, defaultType, position, background] = p;
	if (
		p.length !== 5 ||
		!Array.isArray(texts) ||
		!texts.every(isText) ||
		!isInteger(cancelType) ||
		cancelType < -2 ||
		!isInteger(defaultType) ||
		defaultType < -1
	) {
		return undefined;
	}
	const positionOption = option(CHOICE_POSITIONS, position, 2);
	const backgroundOption = option(BACKGROUNDS, background, 0);
	const choiceBranches = node.branches.filter((branch) => branch.headerCode === 402);
	const cancelBranch = node.branches[choiceBranches.length];
	if (
		positionOption === null ||
		backgroundOption === null ||
		choiceBranches.length !== texts.length ||
		node.branches.length > texts.length + 1 ||
		(cancelBranch && !isCancelHeader(params(context, cancelBranch.headerIndex))) ||
		!choiceBranches.every((branch, index) => {
			const [choiceIndex, text, ...rest] = params(context, branch.headerIndex);
			return (
				node.branches[index] === branch &&
				choiceIndex === index &&
				text === texts[index] &&
				rest.length === 0
			);
		})
	) {
		return undefined;
	}
	const choices = choiceBranches.map((branch, index) =>
		withSegment(
			call("choice", [scriptString(texts[index] as string), branchArrow(branch, context)]),
			context.segment(branch.headerIndex, branch.headerIndex + 1, ""),
		),
	);
	const opts = options([
		[
			"cancel",
			CANCEL_TYPES[cancelType] === undefined
				? numberLiteral(cancelType)
				: scriptString(CANCEL_TYPES[cancelType]),
		],
		[
			"default",
			defaultType === 0
				? undefined
				: defaultType === -1
					? scriptString("none")
					: numberLiteral(defaultType),
		],
		["position", positionOption],
		["background", backgroundOption],
		[
			"onCancel",
			cancelBranch &&
				withSegment(
					branchArrow(cancelBranch, context),
					context.segment(cancelBranch.headerIndex, cancelBranch.headerIndex + 1, ""),
				),
		],
	]);
	const printed = call("showChoices", [arrayLiteral(choices), objectLiteral(opts)]);
	return [printed.doc, context.segment(node.closeIndex, node.end, ""), ";"];
};

/** The parameters the editor writes for When Cancel (`403`), which the engine doesn't read. */
function isCancelHeader(p: readonly unknown[]): boolean {
	return p.length === 2 && p[0] === 6 && p[1] === null;
}

/** A branch body as `() => { … }`; its terminator maps to the closing brace. */
function branchArrow(branch: BlockBranch, context: RenderContext): Expr {
	const statements = context.body(branch.body);
	const close = context.segment(branch.terminatorIndex, branch.end, "");
	return arrowBlock([], statements, close);
}

/** `expr` with a source-map segment (a zero-width mark) printed just before it. */
function withSegment(expr: Expr, segment: Doc): Expr {
	return { ...expr, doc: [segment, expr.doc] };
}

/** 103: `inputNumber(variables.Code, digits);`. */
const inputNumber: CommandRenderer = (node, context) => {
	const p = params(context, node.start);
	const [variable, digits] = p;
	if (p.length !== 2 || !isIndex(variable) || !isIndex(digits)) {
		return undefined;
	}
	const target = symbolReference(context.symbols.reference("variable", variable));
	return statement(call("inputNumber", [target, numberLiteral(digits)]));
};

/** 104: `selectItem(variables.Chosen, "keyItem");`. */
const selectItem: CommandRenderer = (node, context) => {
	const p = params(context, node.start);
	const [variable, itemType] = p;
	const type = nameOf(ITEM_TYPES, itemType);
	if (p.length !== 2 || !isIndex(variable) || type === undefined) {
		return undefined;
	}
	const target = symbolReference(context.symbols.reference("variable", variable));
	return statement(call("selectItem", [target, scriptString(type)]));
};

/** 105 + 405: `showScrollingText({ speed, noFastForward }, "line", …);`. */
const showScrollingText: CommandRenderer = (node, context) => {
	const p = params(context, node.start);
	const [speed, noFastForward] = p;
	const lines = lineTexts(node, context, node.start + 1);
	if (p.length !== 2 || !isInteger(speed) || typeof noFastForward !== "boolean" || !lines) {
		return undefined;
	}
	const opts = options([
		["speed", numberLiteral(speed)],
		["noFastForward", noFastForward ? booleanLiteral(true) : undefined],
	]);
	return linesCall("showScrollingText", opts, lines);
};

/** Characters that end a `//` comment. */
const LINE_TERMINATOR = /[\r\n\p{Zl}\p{Zp}]/u;

/**
 * Whether `//` lines keep these comment lines exactly: no line terminators, and no trailing
 * whitespace (which Prettier and editors trim).
 */
function isSlashable(lines: readonly string[]): boolean {
	return lines.every((text) => !LINE_TERMINATOR.test(text) && !/\s$/.test(text));
}

/**
 * 108 + 408: `//` lines, or `comment("line", …);` when `//` lines wouldn't keep the text. Two
 * comments in a row are separated by a blank line (the printer adds it). Prettier drops blank
 * lines between the comments of a body that has nothing else, so there the last comment uses
 * `comment(…)`.
 */
const comment: CommandRenderer = (node, context) => {
	const lines = lineTexts(node, context);
	if (node.kind !== "command" || !lines) {
		return undefined;
	}
	if (!isSlashable(lines) || endsCommentOnlyBody(node, context)) {
		return linesCall("comment", [], lines);
	}
	return join(
		hardline,
		lines.map((text) => (text === "" ? "//" : `// ${text}`)),
	);
};

/**
 * Whether `node` is the last of two or more comments that make up a whole body, each printed as
 * `//` lines.
 */
function endsCommentOnlyBody(node: CommandNode, context: RenderContext): boolean {
	const { list, depth } = context;
	const next = list[node.end];
	const endsBody =
		next === undefined ||
		(next.code === 0 && next.indent === depth && (depth > 0 || node.end === list.length - 1));
	if (!endsBody) {
		return false;
	}
	let start = node.start;
	while (start > 0 && isCommentAt(list[start - 1], depth)) {
		start--;
	}
	const before = list[start - 1];
	if (
		start === node.start ||
		list[start]?.code !== 108 ||
		(before !== undefined && !(typeof before.indent === "number" && before.indent < depth))
	) {
		return false;
	}
	// Each earlier comment prints as `//` lines too.
	let head = start;
	for (let index = start + 1; index <= node.start; index++) {
		if (list[index]?.code === 108) {
			if (!isPlainComment(list, head, index)) {
				return false;
			}
			head = index;
		}
	}
	return true;
}

function isCommentAt(command: EventCommand | undefined, depth: number): boolean {
	return (command?.code === 108 || command?.code === 408) && command.indent === depth;
}

/** Whether commands `[start, end)` are one comment that prints as `//` lines. */
function isPlainComment(list: readonly EventCommand[], start: number, end: number): boolean {
	const lines: string[] = [];
	for (let index = start; index < end; index++) {
		const command = list[index] as EventCommand;
		const keys = Object.keys(command);
		const [text, ...rest] = Array.isArray(command.parameters) ? command.parameters : [];
		if (keys.join() !== "code,indent,parameters" || typeof text !== "string" || rest.length > 0) {
			return false;
		}
		lines.push(text);
	}
	return isSlashable(lines);
}

/** 355 + 655: `script("line", …);`. */
const script: CommandRenderer = (node, context) => {
	const lines = lineTexts(node, context);
	return node.kind === "command" && lines ? linesCall("script", [], lines) : undefined;
};

/**
 * 356: `plugin.Head(arg, …);`, the line split at single spaces, or `plugin("line");` when it
 * doesn't split cleanly.
 */
const pluginCommand: CommandRenderer = (node, context) => {
	const p = params(context, node.start);
	const [text] = p;
	if (p.length !== 1 || !isText(text)) {
		return undefined;
	}
	const [head, ...args] = text.split(" ");
	if (head === undefined || !isIdentifierName(head) || args.some((arg) => arg === "")) {
		return statement(call("plugin", [scriptString(text)]));
	}
	return statement(methodCall(identifier("plugin"), head, args.map(pluginArgument)));
};

/** A plugin command argument: a canonical, finite number bare, anything else a string. */
function pluginArgument(text: string): Expr {
	const value = Number(text);
	return Number.isFinite(value) && String(value) === text
		? numberLiteral(value)
		: scriptString(text);
}

export const MESSAGE_RENDERERS: readonly (readonly [number, CommandRenderer])[] = [
	[101, showText],
	[102, showChoices],
	[103, inputNumber],
	[104, selectItem],
	[105, showScrollingText],
	[108, comment],
	[355, script],
	[356, pluginCommand],
];
