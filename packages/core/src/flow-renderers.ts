/**
 * Renderers for flow control and game state (spec section 8.1, #41): conditional branches,
 * loops and jumps, common event calls, and switches, variables, self switches and the timer.
 *
 * Each renderer prints a command only when its parameters are exactly what the syntax
 * reproduces (their count and types included), and otherwise declines so the raw fallback keeps
 * the command as it is.
 */
import type { NamedKind } from "./names.js";
import type { CommandRenderer, RenderContext } from "./renderers.js";
import {
	assignment,
	binary,
	block,
	booleanLiteral,
	call,
	callChain,
	computedMember,
	identifier,
	ifStatement,
	member,
	methodCall,
	numberLiteral,
	objectLiteral,
	reference,
	scriptString,
	statement,
	symbolReference,
	unary,
	arrowBlock,
	type Expr,
} from "./script-docs.js";
import { EVENT, nameOf, scriptArgument, troopMember } from "./script-terms.js";

const SELF_SWITCHES = ["A", "B", "C", "D"];
/** Control Variables operations, as assignment operators and as range methods. */
const OPERATORS = ["=", "+=", "-=", "*=", "/=", "%="];
const RANGE_METHODS = ["set", "add", "sub", "mul", "div", "mod"];
/** Conditional Branch comparisons of a variable. */
const COMPARISONS = ["===", ">=", "<=", ">", "<", "!=="];
const DIRECTIONS: Record<number, string> = { 2: "down", 4: "left", 6: "right", 8: "up" };
const VEHICLES = ["boat", "ship", "airship"];
const ACTOR_DATA = [
	"level",
	"exp",
	"hp",
	"mp",
	"maxHp",
	"maxMp",
	"attack",
	"defense",
	"magicAttack",
	"magicDefense",
	"agility",
	"luck",
];
const ENEMY_DATA = [
	"hp",
	"mp",
	"maxHp",
	"maxMp",
	"attack",
	"defense",
	"magicAttack",
	"magicDefense",
	"agility",
	"luck",
];
const CHARACTER_DATA = ["x", "y", "direction", "screenX", "screenY"];
const OTHER_DATA = [
	"game.mapId",
	"party.size",
	"party.gold",
	"party.steps",
	"game.playTime",
	"timer.seconds",
	"game.saveCount",
	"game.battleCount",
	"game.winCount",
	"game.escapeCount",
];
/** Conditional Branch actor checks, as methods taking an entry of a collection. */
const ACTOR_METHODS: Record<number, [method: string, kind: NamedKind]> = {
	3: ["hasSkill", "skill"],
	4: ["hasWeapon", "weapon"],
	5: ["hasArmor", "armor"],
	6: ["hasState", "state"],
};
/** Change-gold style comparisons of the party's gold. */
const GOLD_COMPARISONS = [">=", "<=", "<"];

/** The parameters of the node's first command. */
function params(node: { start: number }, context: RenderContext): unknown[] {
	return context.list[node.start]?.parameters ?? [];
}

/** A reference to entry `id` of `kind`, or `undefined` if `id` isn't a valid id. */
function ref(context: RenderContext, kind: NamedKind, id: unknown): Expr | undefined {
	return isIndex(id) ? symbolReference(context.symbols.reference(kind, id)) : undefined;
}

function isIndex(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0;
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** Text a script string can hold: a string without line breaks (see spec 4.4). */
function isText(value: unknown): value is string {
	return typeof value === "string" && !/[\r\n]/.test(value);
}

/** `0` means ON (or yes) and `1` OFF in MV's switch-like parameters. */
function isOnOff(value: unknown): value is 0 | 1 {
	return value === 0 || value === 1;
}

/** `party.has(entry)`, `party.count(entry)`, … */
function partyCall(method: string, args: readonly Expr[]): Expr {
	return methodCall(identifier("party"), method, args);
}

/** `script(() => code)`, or `script("code")` for code that isn't one expression (spec 8.2). */
function scriptCall(code: unknown): Expr | undefined {
	const argument = scriptArgument(code);
	return argument && call("script", [argument]);
}

function selfSwitch(letter: string, context: RenderContext): Expr {
	context.useEvent();
	return member(member(EVENT, "selfSwitches"), letter);
}

/** 111: the condition of a Conditional Branch, or `undefined` if it can't be printed exactly. */
function condition(p: readonly unknown[], context: RenderContext): Expr | undefined {
	const [type, a, b, c, d] = p;
	const length = p.length;
	switch (type) {
		case 0: {
			const target = length === 3 && isOnOff(b) ? ref(context, "switch", a) : undefined;
			return target && (b === 0 ? target : unary("!", target));
		}
		case 1: {
			const variable = ref(context, "variable", a);
			const operand =
				b === 0 && isNumber(c)
					? numberLiteral(c)
					: b === 1
						? ref(context, "variable", c)
						: undefined;
			const comparison = typeof d === "number" ? COMPARISONS[d] : undefined;
			return length === 5 && variable && operand && comparison
				? binary(variable, comparison, operand)
				: undefined;
		}
		case 2:
			if (length !== 3 || typeof a !== "string" || !SELF_SWITCHES.includes(a) || !isOnOff(b)) {
				return undefined;
			}
			return b === 0 ? selfSwitch(a, context) : unary("!", selfSwitch(a, context));
		case 3:
			return length === 3 && isNumber(a) && isOnOff(b)
				? binary(reference("timer.seconds"), b === 0 ? ">=" : "<=", numberLiteral(a))
				: undefined;
		case 4:
			return actorCondition(p, context);
		case 5: {
			if (!isIndex(a)) {
				return undefined;
			}
			if (b === 0 && length === 3) {
				return member(troopMember(a), "appeared");
			}
			const state = b === 1 && length === 4 ? ref(context, "state", c) : undefined;
			return state && methodCall(troopMember(a), "hasState", [state]);
		}
		case 6: {
			const direction = nameOf(DIRECTIONS, b);
			const target = length === 3 && direction ? context.character(a) : undefined;
			return target && binary(member(target, "direction"), "===", scriptString(direction ?? ""));
		}
		case 7: {
			const comparison = typeof b === "number" ? GOLD_COMPARISONS[b] : undefined;
			return length === 3 && isNumber(a) && comparison
				? binary(reference("party.gold"), comparison, numberLiteral(a))
				: undefined;
		}
		case 8: {
			const item = length === 2 ? ref(context, "item", a) : undefined;
			return item && partyCall("has", [item]);
		}
		case 9:
		case 10: {
			const entry =
				length === 3 && typeof b === "boolean"
					? ref(context, type === 9 ? "weapon" : "armor", a)
					: undefined;
			return (
				entry &&
				partyCall(
					"has",
					b ? [entry, objectLiteral([["includeEquipment", booleanLiteral(true)]])] : [entry],
				)
			);
		}
		case 11:
			return length === 2 && isText(a)
				? methodCall(identifier("input"), "isPressed", [scriptString(a)])
				: undefined;
		case 12:
			return length === 2 ? scriptCall(a) : undefined;
		case 13: {
			const vehicle = typeof a === "number" ? VEHICLES[a] : undefined;
			return length === 2 && vehicle
				? methodCall(identifier("player"), "isRiding", [scriptString(vehicle)])
				: undefined;
		}
		default:
			return undefined;
	}
}

/** 111 with an actor check: in party, name, class, skill, weapon, armor or state. */
function actorCondition(p: readonly unknown[], context: RenderContext): Expr | undefined {
	const [, id, check, value] = p;
	const actor = ref(context, "actor", id);
	if (!actor) {
		return undefined;
	}
	if (check === 0) {
		return p.length === 3 ? partyCall("has", [actor]) : undefined;
	}
	if (p.length !== 4) {
		return undefined;
	}
	if (check === 1) {
		return isText(value) ? binary(member(actor, "name"), "===", scriptString(value)) : undefined;
	}
	if (check === 2) {
		const actorClass = ref(context, "class", value);
		return actorClass && binary(member(actor, "class"), "===", actorClass);
	}
	const method = typeof check === "number" ? ACTOR_METHODS[check] : undefined;
	const entry = method && ref(context, method[1], value);
	return method && entry && methodCall(actor, method[0], [entry]);
}

/** 122: the operand of Control Variables. */
function variableOperand(p: readonly unknown[], context: RenderContext): Expr | undefined {
	const [, , , type, a, b, c] = p;
	switch (type) {
		case 0:
			return p.length === 5 && isNumber(a) ? numberLiteral(a) : undefined;
		case 1:
			return p.length === 5 ? ref(context, "variable", a) : undefined;
		case 2:
			return p.length === 6 && isNumber(a) && isNumber(b)
				? call("random", [numberLiteral(a), numberLiteral(b)])
				: undefined;
		case 3:
			return p.length === 7 ? gameData(a, b, c, context) : undefined;
		case 4:
			return p.length === 5 ? scriptCall(a) : undefined;
		default:
			return undefined;
	}
}

/** 122 game data: party item counts, actor, enemy and character values, and other game values. */
function gameData(type: unknown, a: unknown, b: unknown, context: RenderContext): Expr | undefined {
	const named = (names: readonly string[]) => (typeof b === "number" ? names[b] : undefined);
	switch (type) {
		case 0:
		case 1:
		case 2: {
			const kinds: NamedKind[] = ["item", "weapon", "armor"];
			const entry = b === 0 ? ref(context, kinds[type] as NamedKind, a) : undefined;
			return entry && partyCall("count", [entry]);
		}
		case 3: {
			const actor = ref(context, "actor", a);
			const value = named(ACTOR_DATA);
			return actor && value ? member(actor, value) : undefined;
		}
		case 4: {
			const value = named(ENEMY_DATA);
			return isIndex(a) && value ? member(troopMember(a), value) : undefined;
		}
		case 5: {
			const value = named(CHARACTER_DATA);
			const target = value ? context.character(a) : undefined;
			return target && value ? member(target, value) : undefined;
		}
		case 6:
			return isIndex(a) && b === 0
				? computedMember(member(identifier("party"), "members"), numberLiteral(a))
				: undefined;
		case 7: {
			const value = typeof a === "number" ? OTHER_DATA[a] : undefined;
			return value && b === 0 ? reference(value) : undefined;
		}
		default:
			return undefined;
	}
}

/** 111 / 411 / 412: `if (…) { … } else { … }`, with `else if` for an else holding only an if. */
const conditionalBranch: CommandRenderer = (node, context) => {
	if (node.kind !== "block") {
		return undefined;
	}
	const test = condition(params(node, context), context);
	const [then, otherwise, ...extra] = node.branches;
	if (!test || !then || extra.length > 0) {
		return undefined;
	}
	if (!otherwise) {
		const consequent = block(
			context.body(then.body),
			context.segment(then.terminatorIndex, node.end, ""),
		);
		return ifStatement(test, consequent);
	}
	if (otherwise.headerCode !== 411 || params(otherwise, context).length !== 0) {
		return undefined;
	}
	const consequent = block(
		context.body(then.body),
		context.segment(then.terminatorIndex, otherwise.headerIndex + 1, ""),
	);
	const close = () => context.segment(otherwise.terminatorIndex, node.end, "");
	const [only, ...more] = otherwise.body;
	if (only?.kind === "block" && only.code === 111 && more.length === 0) {
		const nested = context.nested(only);
		if (nested !== undefined) {
			return ifStatement(test, consequent, [nested, close()]);
		}
	}
	return ifStatement(test, consequent, block(context.body(otherwise.body), close()));
};

/** 112 / 413: `loop((loop) => { … });`. */
const loop: CommandRenderer = (node, context) => {
	const [body] = node.kind === "block" ? node.branches : [];
	if (
		!body ||
		node.kind !== "block" ||
		node.branches.length !== 1 ||
		params(node, context).length !== 0
	) {
		return undefined;
	}
	const statements = context.body(body.body, { loop: true });
	const close = context.segment(body.terminatorIndex, node.end, "");
	return statement(call("loop", [arrowBlock(["loop"], statements, close)]));
};

/** A command without parameters, printed as a call. */
function noParameters(print: (context: RenderContext) => Expr): CommandRenderer {
	return (node, context) =>
		params(node, context).length === 0 ? statement(print(context)) : undefined;
}

/** 113: `loop.break();` inside a loop, `breakLoop();` outside any. */
const breakLoop = noParameters((context) =>
	context.inLoop ? methodCall(identifier("loop"), "break", []) : call("breakLoop", []),
);

/** 115: `exitEventProcessing();`. */
const exitEventProcessing = noParameters(() => call("exitEventProcessing", []));

/** 117: `commonEvents.Name();`. */
const commonEvent: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const target = p.length === 1 ? ref(context, "commonEvent", p[0]) : undefined;
	return target && [target.doc, "();"];
};

/** 118 / 119: `label("name");` and `jumpTo("name");`. */
function labelCommand(name: string): CommandRenderer {
	return (node, context) => {
		const p = params(node, context);
		return p.length === 1 && isText(p[0]) ? statement(call(name, [scriptString(p[0])])) : undefined;
	};
}

/** 121: `switches.Name = true;`, or `switches.range(1, 5).set(false);` for a range. */
const controlSwitches: CommandRenderer = (node, context) => {
	const [start, end, value, ...rest] = params(node, context);
	if (rest.length > 0 || !isIndex(start) || !isIndex(end) || !isOnOff(value)) {
		return undefined;
	}
	const on = booleanLiteral(value === 0);
	if (start === end) {
		return [assignment(ref(context, "switch", start) as Expr, "=", on), ";"];
	}
	return statement(
		callChain(identifier("switches"), [
			["range", [numberLiteral(start), numberLiteral(end)]],
			["set", [on]],
		]),
	);
};

/** 122: `variables.Name += 5;`, or `variables.range(1, 5).add(5);` for a range. */
const controlVariables: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [start, end, operation] = p;
	const operator = typeof operation === "number" ? OPERATORS[operation] : undefined;
	const method = typeof operation === "number" ? RANGE_METHODS[operation] : undefined;
	if (!isIndex(start) || !isIndex(end) || !operator || !method) {
		return undefined;
	}
	const operand = variableOperand(p, context);
	if (!operand) {
		return undefined;
	}
	if (start === end) {
		return [assignment(ref(context, "variable", start) as Expr, operator, operand), ";"];
	}
	return statement(
		callChain(identifier("variables"), [
			["range", [numberLiteral(start), numberLiteral(end)]],
			[method, [operand]],
		]),
	);
};

/** 123: `event.selfSwitches.A = true;`. */
const controlSelfSwitch: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [letter, value] = p;
	if (
		p.length !== 2 ||
		typeof letter !== "string" ||
		!SELF_SWITCHES.includes(letter) ||
		!isOnOff(value)
	) {
		return undefined;
	}
	return [assignment(selfSwitch(letter, context), "=", booleanLiteral(value === 0)), ";"];
};

/** 124: `timer.start(seconds);` or `timer.stop();`. */
const controlTimer: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [operation, seconds] = p;
	const timer = identifier("timer");
	if (p.length !== 2) {
		return undefined;
	}
	if (operation === 0 && isNumber(seconds)) {
		return statement(methodCall(timer, "start", [numberLiteral(seconds)]));
	}
	return operation === 1 && seconds === 0 ? statement(methodCall(timer, "stop", [])) : undefined;
};

export const FLOW_RENDERERS: readonly (readonly [number, CommandRenderer])[] = [
	[111, conditionalBranch],
	[112, loop],
	[113, breakLoop],
	[115, exitEventProcessing],
	[117, commonEvent],
	[118, labelCommand("label")],
	[119, labelCommand("jumpTo")],
	[121, controlSwitches],
	[122, controlVariables],
	[123, controlSelfSwitch],
	[124, controlTimer],
];
