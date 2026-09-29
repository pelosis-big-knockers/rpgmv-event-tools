/**
 * The decompiler: prints command lists, and the common events, map events and troops that hold
 * them, as script (see `docs/script-syntax.md`), with a source map back to the commands.
 *
 * Commands print with the renderer registered for their code (`renderers.ts`), or with the raw
 * fallback, `command(code, [parameters])`, which reproduces any command exactly.
 */
import type { EventCommand } from "./commands.js";
import { hardline, join, mark, printDoc, type Doc } from "./layout.js";
import type {
	CommonEvent,
	EventPageConditions,
	ListLocation,
	LocatedCommandList,
	MapEvent,
	Troop,
	TroopPageConditions,
} from "./models.js";
import type { NamedKind } from "./names.js";
import { RENDERERS, type CommandRenderer, type RenderContext } from "./renderers.js";
import {
	and,
	arrayLiteral,
	arrowBlock,
	arrowExpression,
	binary,
	booleanLiteral,
	call,
	identifier,
	jsonLiteral,
	member,
	methodCall,
	numberLiteral,
	objectLiteral,
	reference,
	scriptString,
	statement,
	symbolReference,
	type Expr,
} from "./script-docs.js";
import { EVENT, troopMember } from "./script-terms.js";
import { ScriptSourceMap, type ContainerRef, type SegmentTarget } from "./source-map.js";
import {
	buildStructure,
	type BlockNode,
	type CommandNode,
	type IndexRange,
	type StructureNode,
} from "./structure.js";
import type { MvSymbols } from "./symbols.js";

export interface DecompileContext {
	readonly symbols: MvSymbols;
	/** Renderers by command code. Defaults to the built-in {@link RENDERERS}. */
	readonly renderers?: ReadonlyMap<number, CommandRenderer>;
}

/** A common event, map event or troop to print, with its id (its position in its file). */
export type ScriptContainer =
	| { kind: "commonEvent"; id: number; commonEvent: CommonEvent }
	| { kind: "mapEvent"; mapId: number; id: number; event: MapEvent }
	| { kind: "troop"; id: number; troop: Troop };

/** How many commands were printed, and how many of them with the raw fallback. */
export interface FallbackCoverage {
	readonly commands: number;
	readonly rawByCode: ReadonlyMap<number, number>;
}

export interface DecompiledScript {
	readonly text: string;
	readonly sourceMap: ScriptSourceMap;
	readonly coverage: FallbackCoverage;
}

/** The first line of every script document: where its globals are declared. */
export const REFERENCE_LINE = '/// <reference types="rpgmv-event-tools" />';

/** Prints a script document: the reference line, then each container. */
export function decompileDocument(
	containers: readonly ScriptContainer[],
	context: DecompileContext,
): DecompiledScript {
	const printer = new ScriptPrinter(context);
	const printed = containers.map((container) => printer.container(container));
	return printer.finish([
		REFERENCE_LINE,
		printed.length > 0 ? [hardline, hardline, join([hardline, hardline], printed)] : "",
		hardline,
	]);
}

/**
 * Prints the statements of one command list, without a container around them, for example for a
 * preview. The list's final `0` has no line of its own here, so the source map leaves it out.
 */
export function decompile(
	located: LocatedCommandList,
	context: DecompileContext,
): DecompiledScript {
	const printer = new ScriptPrinter(context);
	const { statements } = printer.listBody(located.location, located.list);
	return printer.finish(statements.length > 0 ? [join(hardline, statements), hardline] : "");
}

/** Adds up the coverage of several scripts. */
export function sumCoverage(coverages: Iterable<FallbackCoverage>): FallbackCoverage {
	let commands = 0;
	const rawByCode = new Map<number, number>();
	for (const coverage of coverages) {
		commands += coverage.commands;
		for (const [code, count] of coverage.rawByCode) {
			rawByCode.set(code, (rawByCode.get(code) ?? 0) + count);
		}
	}
	return { commands, rawByCode };
}

const COMMON_EVENT_TRIGGERS = ["none", "autorun", "parallel"];
const PAGE_TRIGGERS = ["action", "playerTouch", "eventTouch", "autorun", "parallel"];
const TROOP_SPANS = ["battle", "turn", "moment"];
const SELF_SWITCHES = ["A", "B", "C", "D"];

interface MutableSegment {
	startLine: number;
	endLine: number;
	readonly target: SegmentTarget;
}

/** A printed command list: its statements, and what its container needs to know about it. */
interface ListBody {
	readonly location: ListLocation;
	readonly statements: Doc[];
	/** Whether the statements use the running event, so the body declares `event`. */
	readonly usesEvent: boolean;
	/**
	 * The usual final `0`, which the script leaves out, or `undefined` if the list doesn't end
	 * with one.
	 */
	readonly end: IndexRange | undefined;
}

class ScriptPrinter {
	readonly #symbols: MvSymbols;
	readonly #renderers: ReadonlyMap<number, CommandRenderer>;
	#segments: MutableSegment[] = [];
	#commands = 0;
	#rawByCode = new Map<number, number>();

	constructor(context: DecompileContext) {
		this.#symbols = context.symbols;
		this.#renderers = context.renderers ?? RENDERERS;
	}

	finish(doc: Doc): DecompiledScript {
		const text = printDoc(doc);
		const unprinted = this.#segments.find((segment) => segment.startLine < 0);
		if (unprinted) {
			throw new Error(`A source-map segment was never printed: ${JSON.stringify(unprinted)}`);
		}
		return {
			text,
			sourceMap: new ScriptSourceMap(this.#segments),
			coverage: { commands: this.#commands, rawByCode: this.#rawByCode },
		};
	}

	container(container: ScriptContainer): Doc {
		switch (container.kind) {
			case "commonEvent":
				return this.#commonEvent(container.id, container.commonEvent);
			case "mapEvent":
				return this.#mapEvent(container.mapId, container.id, container.event);
			case "troop":
				return this.#troop(container.id, container.troop);
		}
	}

	#commonEvent(id: number, commonEvent: CommonEvent): Doc {
		const ref: ContainerRef = { kind: "commonEvent", commonEventId: id };
		const body = this.listBody({ kind: "commonEvent", commonEventId: id }, commonEvent.list);
		const trigger = commonEvent.trigger;
		const options: [string, Expr][] = [
			["id", numberLiteral(id)],
			["name", scriptString(commonEvent.name)],
			["trigger", enumValue(COMMON_EVENT_TRIGGERS, trigger)],
		];
		if (trigger !== 0) {
			options.push(["switch", this.#reference("switch", commonEvent.switchId)]);
		}
		addEnd(options, body);
		const printed = call("defineCommonEvent", [objectLiteral(options), this.#bodyArrow(body)]);
		return this.#segment({ kind: "container", container: ref }, statement(printed));
	}

	#mapEvent(mapId: number, id: number, event: MapEvent): Doc {
		const ref: ContainerRef = { kind: "mapEvent", mapId, eventId: id };
		const pages = event.pages.map((page, pageIndex) => {
			const body = this.listBody({ kind: "mapEvent", mapId, eventId: id, pageIndex }, page.list);
			const options: [string, Expr][] = [["trigger", enumValue(PAGE_TRIGGERS, page.trigger)]];
			this.#addConditions(options, this.#mapWhen(page.conditions), page.conditions);
			addEnd(options, body);
			return this.#pageCall(ref, pageIndex, options, body);
		});
		const options: [string, Expr][] = [
			["id", numberLiteral(id)],
			["name", scriptString(event.name)],
			["x", numberLiteral(event.x)],
			["y", numberLiteral(event.y)],
		];
		const printed = call("defineMapEvent", [objectLiteral(options), arrayLiteral(pages)]);
		return this.#segment({ kind: "container", container: ref }, statement(printed));
	}

	#troop(id: number, troop: Troop): Doc {
		const ref: ContainerRef = { kind: "troop", troopId: id };
		const pages = troop.pages.map((page, pageIndex) => {
			const body = this.listBody({ kind: "troop", troopId: id, pageIndex }, page.list);
			const options: [string, Expr][] = [["span", enumValue(TROOP_SPANS, page.span)]];
			this.#addConditions(options, this.#troopWhen(page.conditions), page.conditions);
			addEnd(options, body);
			return this.#pageCall(ref, pageIndex, options, body);
		});
		const options: [string, Expr][] = [
			["id", numberLiteral(id)],
			["name", scriptString(troop.name)],
		];
		const printed = call("defineTroop", [objectLiteral(options), arrayLiteral(pages)]);
		return this.#segment({ kind: "container", container: ref }, statement(printed));
	}

	#pageCall(
		container: ContainerRef,
		pageIndex: number,
		options: [string, Expr][],
		body: ListBody,
	): Expr {
		const printed = call("page", [objectLiteral(options), this.#bodyArrow(body)]);
		return {
			...printed,
			doc: this.#segment({ kind: "page", container, pageIndex }, printed.doc),
		};
	}

	/** Adds `when` for conditions it can express, or else the stored `conditions` as they are. */
	#addConditions(options: [string, Expr][], when: Expr | null | undefined, stored: unknown): void {
		if (when === undefined) {
			options.push(["conditions", jsonLiteral(stored)]);
		} else if (when !== null) {
			options.push(["when", when]);
		}
	}

	/**
	 * A map page's conditions as a `when` function, `null` if there are none, or `undefined` if
	 * `when` can't express them exactly.
	 */
	#mapWhen(conditions: EventPageConditions): Expr | null | undefined {
		const flags = [
			"switch1Valid",
			"switch2Valid",
			"variableValid",
			"selfSwitchValid",
			"itemValid",
			"actorValid",
		] as const;
		if (flags.some((flag) => typeof conditions[flag] !== "boolean")) {
			return undefined;
		}
		const checks: (Expr | undefined)[] = [];
		let usesEvent = false;
		if (conditions.switch1Valid) {
			checks.push(this.#referenceOrUndefined("switch", conditions.switch1Id));
		}
		if (conditions.switch2Valid) {
			checks.push(this.#referenceOrUndefined("switch", conditions.switch2Id));
		}
		if (conditions.variableValid) {
			const variable = this.#referenceOrUndefined("variable", conditions.variableId);
			const value = conditions.variableValue;
			checks.push(
				variable && isFiniteNumber(value)
					? binary(variable, ">=", numberLiteral(value))
					: undefined,
			);
		}
		if (conditions.selfSwitchValid) {
			const letter = conditions.selfSwitchCh;
			usesEvent = true;
			checks.push(
				SELF_SWITCHES.includes(letter) ? member(member(EVENT, "selfSwitches"), letter) : undefined,
			);
		}
		if (conditions.itemValid) {
			checks.push(this.#partyHas("item", conditions.itemId));
		}
		if (conditions.actorValid) {
			checks.push(this.#partyHas("actor", conditions.actorId));
		}
		return whenFunction(usesEvent ? ["event"] : [], checks);
	}

	/** A troop page's conditions, as {@link #mapWhen} does for map pages. */
	#troopWhen(conditions: TroopPageConditions): Expr | null | undefined {
		const flags = ["turnEnding", "turnValid", "enemyValid", "actorValid", "switchValid"] as const;
		if (flags.some((flag) => typeof conditions[flag] !== "boolean")) {
			return undefined;
		}
		const checks: (Expr | undefined)[] = [];
		if (conditions.turnEnding) {
			checks.push(reference("troop.turnEnding"));
		}
		if (conditions.turnValid) {
			const { turnA, turnB } = conditions;
			checks.push(
				isIndex(turnA) && isIndex(turnB)
					? methodCall(
							identifier("troop"),
							"turn",
							turnB === 0 ? [numberLiteral(turnA)] : [numberLiteral(turnA), numberLiteral(turnB)],
						)
					: undefined,
			);
		}
		if (conditions.enemyValid) {
			const { enemyIndex, enemyHp } = conditions;
			checks.push(
				isIndex(enemyIndex) && isFiniteNumber(enemyHp)
					? binary(member(troopMember(enemyIndex), "hpPercent"), "<=", numberLiteral(enemyHp))
					: undefined,
			);
		}
		if (conditions.actorValid) {
			const actor = this.#referenceOrUndefined("actor", conditions.actorId);
			checks.push(
				actor && isFiniteNumber(conditions.actorHp)
					? binary(member(actor, "hpPercent"), "<=", numberLiteral(conditions.actorHp))
					: undefined,
			);
		}
		if (conditions.switchValid) {
			checks.push(this.#referenceOrUndefined("switch", conditions.switchId));
		}
		return whenFunction([], checks);
	}

	#partyHas(kind: "item" | "actor", id: unknown): Expr | undefined {
		const target = this.#referenceOrUndefined(kind, id);
		return target && methodCall(identifier("party"), "has", [target]);
	}

	#reference(kind: NamedKind, id: number): Expr {
		return symbolReference(this.#symbols.reference(kind, id));
	}

	/** A reference to entry `id`, or `undefined` if `id` isn't a valid id. */
	#referenceOrUndefined(kind: NamedKind, id: unknown): Expr | undefined {
		return isIndex(id) ? this.#reference(kind, id) : undefined;
	}

	/** Prints a command list as the statements of a body. */
	listBody(location: ListLocation, list: readonly EventCommand[]): ListBody {
		const nodes = buildStructure(list);
		this.#commands += list.length;
		const last = nodes.at(-1);
		const hasEnd = last?.kind === "end";
		const state = { usesEvent: false };
		const statements = this.#statements(
			location,
			list,
			hasEnd ? nodes.slice(0, -1) : nodes,
			0,
			state,
		);
		return {
			location,
			statements,
			usesEvent: state.usesEvent,
			end: hasEnd ? last : undefined,
		};
	}

	/**
	 * The body as an arrow function: `(event) => { … }` if it uses the running event. The list's
	 * final `0` maps to the closing brace.
	 */
	#bodyArrow(body: ListBody): Expr {
		const beforeClose = body.end
			? this.#segment(
					{ kind: "commands", location: body.location, start: body.end.start, end: body.end.end },
					"",
				)
			: "";
		return arrowBlock(body.usesEvent ? ["event"] : [], body.statements, beforeClose);
	}

	#statements(
		location: ListLocation,
		list: readonly EventCommand[],
		nodes: readonly StructureNode[],
		depth: number,
		state: { usesEvent: boolean },
		inLoop = false,
	): Doc[] {
		const statements: Doc[] = [];
		let previous: StructureNode | undefined;
		for (const node of nodes) {
			// A blank line separates two comments, so they compile back as two (spec 7.6).
			const blank = isComment(previous) && isComment(node);
			previous = node;
			const first = statements.length;
			const rendered = this.#render(location, list, node, depth, state, inLoop);
			if (rendered !== undefined) {
				statements.push(rendered);
			} else {
				for (let index = node.start; index < node.end; index++) {
					statements.push(this.#raw(location, list[index] as EventCommand, index, depth));
				}
			}
			if (blank) {
				statements[first] = [hardline, statements[first] as Doc];
			}
		}
		return statements;
	}

	/**
	 * Prints a node with its renderer, if it has one and the renderer can print it. Anything the
	 * renderer recorded is undone when it declines.
	 */
	#render(
		location: ListLocation,
		list: readonly EventCommand[],
		node: StructureNode,
		depth: number,
		state: { usesEvent: boolean },
		inLoop: boolean,
	): Doc | undefined {
		if (node.kind !== "command" && node.kind !== "block") {
			return undefined;
		}
		const renderer = this.#renderers.get(node.code);
		if (!renderer || !hasPlainStructure(list, node)) {
			return undefined;
		}
		const saved = {
			segments: this.#segments.length,
			rawByCode: new Map(this.#rawByCode),
			usesEvent: state.usesEvent,
		};
		const context: RenderContext = {
			list,
			symbols: this.#symbols,
			depth,
			inLoop,
			body: (nodes, options) =>
				this.#statements(location, list, nodes, depth + 1, state, inLoop || options?.loop === true),
			nested: (nested) => this.#render(location, list, nested, depth + 1, state, inLoop),
			segment: (start, end, doc) => this.#segment({ kind: "commands", location, start, end }, doc),
			useEvent: () => {
				state.usesEvent = true;
			},
		};
		const doc = renderer(node, context);
		if (doc === undefined) {
			this.#segments.length = saved.segments;
			this.#rawByCode = saved.rawByCode;
			state.usesEvent = saved.usesEvent;
			return undefined;
		}
		return this.#segment({ kind: "commands", location, start: node.start, end: node.end }, doc);
	}

	/** The raw fallback for one command. */
	#raw(location: ListLocation, command: EventCommand, index: number, depth: number): Doc {
		const code = typeof command.code === "number" ? command.code : Number.NaN;
		this.#rawByCode.set(code, (this.#rawByCode.get(code) ?? 0) + 1);
		const target: SegmentTarget = { kind: "commands", location, start: index, end: index + 1 };
		return this.#segment(target, statement(rawCommand(command, depth)));
	}

	#segment(target: SegmentTarget, doc: Doc): Doc {
		const segment: MutableSegment = { startLine: -1, endLine: -1, target };
		this.#segments.push(segment);
		return [
			mark((line) => {
				segment.startLine = line;
			}),
			doc,
			mark((line) => {
				segment.endLine = line;
			}),
		];
	}
}

/**
 * `command(code, [parameters])`, with `{ indent }` when the stored indent isn't the nesting
 * depth. A command object with other keys, or its keys in another order, prints whole as
 * `command({ … })` so it is kept exactly.
 */
function rawCommand(command: EventCommand, depth: number): Expr {
	if (!isPlainCommand(command)) {
		return call("command", [jsonLiteral(command)]);
	}
	const args = [numberLiteral(command.code), jsonLiteral(command.parameters)];
	if (command.indent !== depth) {
		args.push(objectLiteral([["indent", jsonLiteral(command.indent)]]));
	}
	return call("command", args);
}

/** A command with exactly the keys `code`, `indent` and `parameters`, in that order. */
function isPlainCommand(command: EventCommand | undefined): boolean {
	if (!command) {
		return false;
	}
	const keys = Object.keys(command);
	return (
		keys.length === 3 &&
		keys[0] === "code" &&
		keys[1] === "indent" &&
		keys[2] === "parameters" &&
		typeof command.code === "number" &&
		Array.isArray(command.parameters)
	);
}

/**
 * Whether a node's own commands are plain, and its terminators and closer have no parameters,
 * which a renderer needs because the script leaves those commands out. Its bodies are printed
 * separately.
 */
function hasPlainStructure(list: readonly EventCommand[], node: CommandNode | BlockNode): boolean {
	if (node.kind === "command") {
		for (let index = node.start; index < node.end; index++) {
			if (!isPlainCommand(list[index])) {
				return false;
			}
		}
		return true;
	}
	const isEmpty = (index: number) =>
		isPlainCommand(list[index]) && (list[index] as EventCommand).parameters.length === 0;
	return (
		isPlainCommand(list[node.start]) &&
		node.branches.every(
			(branch) => isPlainCommand(list[branch.headerIndex]) && isEmpty(branch.terminatorIndex),
		) &&
		isEmpty(node.closeIndex)
	);
}

/** Whether a node is a Comment command (`108` and its `408` lines). */
function isComment(node: StructureNode | undefined): boolean {
	return node?.kind === "command" && node.code === 108;
}

/** Adds `end: false` for a list without the usual final `0`, so it isn't added on compile. */
function addEnd(options: [string, Expr][], body: ListBody): void {
	if (!body.end) {
		options.push(["end", booleanLiteral(false)]);
	}
}

/** `(params) => a && b`, `null` with no checks, or `undefined` if a check can't be expressed. */
function whenFunction(
	parameters: readonly string[],
	checks: readonly (Expr | undefined)[],
): Expr | null | undefined {
	if (checks.some((check) => check === undefined)) {
		return undefined;
	}
	return checks.length === 0 ? null : arrowExpression(parameters, and(checks as Expr[]));
}

/** An enum value by name, or the stored value when it has none. */
function enumValue(names: readonly string[], value: unknown): Expr {
	const name = typeof value === "number" ? names[value] : undefined;
	return name === undefined ? jsonLiteral(value) : scriptString(name);
}

function isIndex(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
