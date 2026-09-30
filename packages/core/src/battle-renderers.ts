/**
 * Renderers for battle and the remaining commands (spec section 8.4, #44): Battle Processing
 * with its result handlers, Shop Processing, and the party, actor, enemy, system settings, map
 * and scene control commands.
 *
 * Each renderer prints a command only when its parameters are exactly what the syntax
 * reproduces (their count and types included), and otherwise declines so the raw fallback keeps
 * the command as it is.
 */
import type { NamedKind } from "./names.js";
import type { CommandRenderer, RenderContext } from "./renderers.js";
import {
	arrayLiteral,
	arrowBlock,
	booleanLiteral,
	call,
	callChain,
	computedMember,
	identifier,
	methodCall,
	nullLiteral,
	numberLiteral,
	objectLiteral,
	scriptString,
	statement,
	symbolReference,
	unary,
	type Expr,
} from "./script-docs.js";
import { troopMember } from "./script-terms.js";

const VEHICLES = ["boat", "ship", "airship"];
const PARAMETERS = [
	"maxHp",
	"maxMp",
	"attack",
	"defense",
	"magicAttack",
	"magicDefense",
	"agility",
	"luck",
];
const LOCATION_INFO = [
	"terrainTag",
	"eventId",
	"tileIdLayer1",
	"tileIdLayer2",
	"tileIdLayer3",
	"tileIdLayer4",
	"regionId",
];
const GOODS: readonly NamedKind[] = ["item", "weapon", "armor"];
/** Battle Processing's result branches, by branch code. */
const HANDLERS: Record<number, string> = { 601: "onWin", 602: "onEscape", 603: "onLose" };
/** Audio defaults (the MV editor's), left out of the options. */
const AUDIO_DEFAULTS = { volume: 90, pitch: 100, pan: 0 } as const;

type Args = readonly (Expr | undefined)[] | undefined;
type Options = readonly (readonly [key: string, value: Expr])[];

/** The parameters of the command at `index`. */
function paramsAt(context: RenderContext, index: number): unknown[] {
	return context.list[index]?.parameters ?? [];
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

function text(value: unknown): Expr | undefined {
	return isText(value) ? scriptString(value) : undefined;
}

function number(value: unknown): Expr | undefined {
	return isNumber(value) ? numberLiteral(value) : undefined;
}

/** An enum value by name, or `undefined` for a value without one. */
function named(names: readonly string[], value: unknown): Expr | undefined {
	const name = typeof value === "number" ? names[value] : undefined;
	return name === undefined ? undefined : scriptString(name);
}

/** `0` means ON (or enable) and `1` OFF in MV's switch-like parameters; `true` is ON. */
function onOff(value: unknown, on: 0 | 1): Expr | undefined {
	return value === 0 || value === 1 ? booleanLiteral(value === on) : undefined;
}

/** The options argument: none when every option has its default. */
function options(entries: Options): Expr[] {
	return entries.length === 0 ? [] : [objectLiteral(entries)];
}

/** A boolean option printed only when `true`; `undefined` (not printable) if not a boolean. */
function flag(key: string, value: unknown): Options | undefined {
	if (typeof value !== "boolean") {
		return undefined;
	}
	return value ? [[key, booleanLiteral(true)]] : [];
}

/**
 * An amount with an operation, printed signed: `+10`, `-variables.Damage`. `operation` is 0
 * increase or 1 decrease, `type` 0 constant or 1 variable. A constant must not be negative, so
 * the sign is the operation.
 */
function amount(
	context: RenderContext,
	operation: unknown,
	type: unknown,
	operand: unknown,
): Expr | undefined {
	const sign = operation === 0 ? "+" : operation === 1 ? "-" : undefined;
	const value =
		type === 0 && isNumber(operand) && operand >= 0 && !Object.is(operand, -0)
			? numberLiteral(operand)
			: type === 1
				? ref(context, "variable", operand)
				: undefined;
	return sign && value && unary(sign, value);
}

/**
 * An actor target: `actors.X` or `party` (fixed actor 0, the entire party) for designation 0,
 * and `actors[variables.V]` for designation 1.
 */
function actorTarget(context: RenderContext, designation: unknown, id: unknown): Expr | undefined {
	if (designation === 0) {
		return id === 0 ? identifier("party") : ref(context, "actor", id);
	}
	const variable = designation === 1 ? ref(context, "variable", id) : undefined;
	return variable && computedMember(identifier("actors"), variable);
}

/** An enemy target: `troop.members[i]`, or `troop` for -1 (the entire troop). */
function enemyTarget(index: unknown): Expr | undefined {
	if (index === -1) {
		return identifier("troop");
	}
	return isIndex(index) ? troopMember(index) : undefined;
}

/**
 * The arguments for an audio parameter: `"Name"`, then options for a volume, pitch or pan other
 * than the default. `undefined` unless the object has exactly MV's keys, in MV's order.
 */
function audio(value: unknown): Expr[] | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.join() !== "name,volume,pitch,pan" || !isText(record["name"])) {
		return undefined;
	}
	const entries: [string, Expr][] = [];
	for (const [key, fallback] of Object.entries(AUDIO_DEFAULTS)) {
		const setting = record[key];
		if (!isNumber(setting)) {
			return undefined;
		}
		if (setting !== fallback) {
			entries.push([key, numberLiteral(setting)]);
		}
	}
	return [scriptString(record["name"]), ...options(entries)];
}

/**
 * A command with exactly `length` parameters and no continuation lines, printed as
 * `name(arguments);`. `args` returns `undefined`, or an `undefined` argument, when the parameters
 * can't be printed exactly.
 */
function simple(
	name: string,
	length: number,
	args: (p: readonly unknown[], context: RenderContext) => Args = () => [],
): CommandRenderer {
	return (node, context) => {
		if (node.kind !== "command" || node.end !== node.start + 1) {
			return undefined;
		}
		const p = paramsAt(context, node.start);
		const printed = p.length === length ? args(p, context) : undefined;
		if (!printed || printed.some((arg) => arg === undefined)) {
			return undefined;
		}
		return statement(call(name, printed as Expr[]));
	};
}

/** `args` followed by the options argument, or `undefined` if the options can't be printed. */
function withOptions(args: readonly (Expr | undefined)[], opts: Options | undefined): Args {
	return opts && [...args, ...options(opts)];
}

/**
 * The troop of a battle: `troops.X`, `troops[variables.V]`, or `"randomEncounter"` (the map's
 * encounter list; the id is then unused, and only the `0` the editor writes prints).
 */
function battleTroop(context: RenderContext, designation: unknown, id: unknown): Expr | undefined {
	switch (designation) {
		case 0:
			return ref(context, "troop", id);
		case 1: {
			const variable = ref(context, "variable", id);
			return variable && computedMember(identifier("troops"), variable);
		}
		case 2:
			return id === 0 ? scriptString("randomEncounter") : undefined;
		default:
			return undefined;
	}
}

/** 301 / 601–604: `battle(troop);` or `battle(troop, { onWin, onEscape, onLose });`. */
const battle: CommandRenderer = (node, context) => {
	const p = paramsAt(context, node.start);
	const [designation, id, canEscape, canLose] = p;
	if (p.length !== 4 || typeof canEscape !== "boolean" || typeof canLose !== "boolean") {
		return undefined;
	}
	const troop = battleTroop(context, designation, id);
	if (!troop) {
		return undefined;
	}
	if (node.kind === "command") {
		return !canEscape && !canLose && node.end === node.start + 1
			? statement(call("battle", [troop]))
			: undefined;
	}
	// The compiler writes If Win, then If Escape and If Lose exactly when the flags are set.
	const expected = [601, ...(canEscape ? [602] : []), ...(canLose ? [603] : [])];
	const { branches } = node;
	if (
		branches.length !== expected.length ||
		branches.some(
			(branch, index) =>
				branch.headerCode !== expected[index] || paramsAt(context, branch.headerIndex).length !== 0,
		)
	) {
		return undefined;
	}
	const handlers = branches.map((branch): [string, Expr] => {
		const handler = arrowBlock(
			[],
			context.body(branch.body),
			context.segment(branch.terminatorIndex, branch.end, ""),
		);
		const header = context.segment(branch.headerIndex, branch.headerIndex + 1, "");
		return [HANDLERS[branch.headerCode] as string, { ...handler, doc: [header, handler.doc] }];
	});
	const printed = call("battle", [troop, objectLiteral(handlers)]);
	return [printed.doc, context.segment(node.closeIndex, node.end, ""), ";"];
};

/** The arguments of one shop item (302 or 605): the entry, and `{ price }` if specified. */
function goods(context: RenderContext, p: readonly unknown[]): Expr[] | undefined {
	const [type, id, priceType, price] = p;
	const kind = typeof type === "number" ? GOODS[type] : undefined;
	const entry = kind && ref(context, kind, id);
	if (!entry) {
		return undefined;
	}
	if (priceType === 0 && price === 0) {
		return [entry];
	}
	return priceType === 1 && isNumber(price)
		? [entry, objectLiteral([["price", numberLiteral(price)]])]
		: undefined;
}

/** 302 + 605: `shop({ purchaseOnly: true }).goods(items.Potion).goods(…);`. */
const shop: CommandRenderer = (node, context) => {
	if (node.kind !== "command") {
		return undefined;
	}
	const head = paramsAt(context, node.start);
	const purchaseOnly = flag("purchaseOnly", head[4]);
	if (head.length !== 5 || !purchaseOnly) {
		return undefined;
	}
	const calls: [string, Expr[]][] = [];
	for (let index = node.start; index < node.end; index++) {
		const p = paramsAt(context, index);
		const args = p.length === (index === node.start ? 5 : 4) ? goods(context, p) : undefined;
		if (!args) {
			return undefined;
		}
		calls.push(["goods", args]);
	}
	const opener = call("shop", options(purchaseOnly));
	const [only] = calls;
	return statement(
		calls.length === 1 && only ? methodCall(opener, only[0], only[1]) : callChain(opener, calls),
	);
};

/** 126–128: `changeItems(items.X, +1);`, with `{ includeEquipment: true }` for 127 and 128. */
function changeGoods(name: string, kind: NamedKind): CommandRenderer {
	const equipment = kind !== "item";
	return simple(name, equipment ? 5 : 4, (p, context) =>
		withOptions(
			[ref(context, kind, p[0]), amount(context, p[1], p[2], p[3])],
			equipment ? flag("includeEquipment", p[4]) : [],
		),
	);
}

/** 312, 326: `changeMp(target, amount);`. */
function changeActorValue(name: string): CommandRenderer {
	return simple(name, 5, (p, context) => [
		actorTarget(context, p[0], p[1]),
		amount(context, p[2], p[3], p[4]),
	]);
}

/** 315, 316: `changeExp(target, amount, { showLevelUp: true });`. */
function changeActorGrowth(name: string): CommandRenderer {
	return simple(name, 6, (p, context) =>
		withOptions(
			[actorTarget(context, p[0], p[1]), amount(context, p[2], p[3], p[4])],
			flag("showLevelUp", p[5]),
		),
	);
}

/** 320, 324, 325: `changeName(actors.X, "text");`. */
function changeActorText(name: string): CommandRenderer {
	return simple(name, 2, (p, context) => [ref(context, "actor", p[0]), text(p[1])]);
}

/** 332, 342: `changeEnemyMp(enemy, amount);`. */
function changeEnemyValue(name: string): CommandRenderer {
	return simple(name, 4, (p, context) => [enemyTarget(p[0]), amount(context, p[1], p[2], p[3])]);
}

/** 134–137: `changeSaveAccess(true);` (true: enabled). */
function access(name: string): CommandRenderer {
	return simple(name, 1, (p) => [onOff(p[0], 1)]);
}

/** 132, 133, 139: `changeBattleBgm("Battle2", { volume: 80 });`. */
function changeAudio(name: string): CommandRenderer {
	return simple(name, 1, (p) => audio(p[0]));
}

/** 339: `forceAction(subject, skills.X, target)`; the subject is an enemy or an actor. */
function forceActionArgs(p: readonly unknown[], context: RenderContext): Args {
	const [type, subject, skill, target] = p;
	const battler =
		type === 0
			? enemyTarget(subject)
			: type === 1
				? subject === 0
					? identifier("party")
					: ref(context, "actor", subject)
				: undefined;
	const targetExpr =
		target === -2
			? scriptString("lastTarget")
			: target === -1
				? scriptString("random")
				: isIndex(target)
					? numberLiteral(target)
					: undefined;
	return [battler, ref(context, "skill", skill), targetExpr];
}

/** 285: `getLocationInfo(variables.V, "regionId", x, y);`, x and y from variables or not. */
function locationInfoArgs(p: readonly unknown[], context: RenderContext): Args {
	const [variable, info, designation, x, y] = p;
	const position =
		designation === 0
			? [number(x), number(y)]
			: designation === 1
				? [ref(context, "variable", x), ref(context, "variable", y)]
				: undefined;
	return position && [ref(context, "variable", variable), named(LOCATION_INFO, info), ...position];
}

/** 319: `changeEquipment(actors.X, equipTypes.Y, weapons.Z)`; `null` removes the equipment. */
function equipmentArgs(p: readonly unknown[], context: RenderContext): Args {
	const [actor, equipType, item] = p;
	const entry = item === 0 ? nullLiteral : ref(context, equipType === 1 ? "weapon" : "armor", item);
	return [ref(context, "actor", actor), ref(context, "equipType", equipType), entry];
}

/** 337: `showBattleAnimation(enemy, animations.X);`, with `troop` for the entire troop. */
function battleAnimationArgs(p: readonly unknown[], context: RenderContext): Args {
	const [index, animation, entireTroop] = p;
	// The editor writes index 0 when Entire Troop is checked; the engine then ignores the index.
	const target =
		entireTroop === true && index === 0
			? identifier("troop")
			: entireTroop === false && isIndex(index)
				? troopMember(index)
				: undefined;
	return [target, ref(context, "animation", animation)];
}

/** 138: `changeWindowColor([red, green, blue, 0]);`. */
function toneArgs(p: readonly unknown[]): Args {
	const [tone] = p;
	return Array.isArray(tone) && tone.length === 4 && tone.every(isNumber)
		? [arrayLiteral(tone.map((value) => numberLiteral(value)))]
		: undefined;
}

/** 284: `changeParallax("name", { loopX: true, loopY: true, scrollX: 2, scrollY: 0 });`. */
function parallaxArgs(p: readonly unknown[]): Args {
	const [name, loopX, loopY, scrollX, scrollY] = p;
	const loops = [flag("loopX", loopX), flag("loopY", loopY)];
	if (!isNumber(scrollX) || !isNumber(scrollY) || loops.some((loop) => !loop)) {
		return undefined;
	}
	const scroll: [string, Expr][] = [];
	if (scrollX !== 0) {
		scroll.push(["scrollX", numberLiteral(scrollX)]);
	}
	if (scrollY !== 0) {
		scroll.push(["scrollY", numberLiteral(scrollY)]);
	}
	return [text(name), ...options([...(loops as Options[]).flat(), ...scroll])];
}

export const BATTLE_RENDERERS: readonly (readonly [number, CommandRenderer])[] = [
	// Party
	[125, simple("changeGold", 3, (p, context) => [amount(context, p[0], p[1], p[2])])],
	[126, changeGoods("changeItems", "item")],
	[127, changeGoods("changeWeapons", "weapon")],
	[128, changeGoods("changeArmors", "armor")],
	[
		129,
		simple("changePartyMember", 3, (p, context) =>
			withOptions(
				[ref(context, "actor", p[0]), named(["add", "remove"], p[1])],
				flag("initialize", p[2]),
			),
		),
	],
	// System settings
	[132, changeAudio("changeBattleBgm")],
	[133, changeAudio("changeVictoryMe")],
	[134, access("changeSaveAccess")],
	[135, access("changeMenuAccess")],
	[136, access("changeEncounter")],
	[137, access("changeFormationAccess")],
	[138, simple("changeWindowColor", 1, toneArgs)],
	[139, changeAudio("changeDefeatMe")],
	[
		140,
		simple("changeVehicleBgm", 2, (p) => {
			const sound = audio(p[1]);
			return sound && [named(VEHICLES, p[0]), ...sound];
		}),
	],
	// Map
	[281, simple("changeMapNameDisplay", 1, (p) => [onOff(p[0], 0)])],
	[282, simple("changeTileset", 1, (p, context) => [ref(context, "tileset", p[0])])],
	[283, simple("changeBattleBack", 2, (p) => [text(p[0]), text(p[1])])],
	[284, simple("changeParallax", 5, parallaxArgs)],
	[285, simple("getLocationInfo", 5, locationInfoArgs)],
	// Scene control
	[301, battle],
	[302, shop],
	[
		303,
		simple("nameInputProcessing", 2, (p, context) => [ref(context, "actor", p[0]), number(p[1])]),
	],
	[351, simple("openMenuScreen", 0)],
	[352, simple("openSaveScreen", 0)],
	[353, simple("gameOver", 0)],
	[354, simple("returnToTitleScreen", 0)],
	// Actor
	[
		311,
		simple("changeHp", 6, (p, context) =>
			withOptions(
				[actorTarget(context, p[0], p[1]), amount(context, p[2], p[3], p[4])],
				flag("allowKnockout", p[5]),
			),
		),
	],
	[312, changeActorValue("changeMp")],
	[
		313,
		simple("changeState", 4, (p, context) => [
			actorTarget(context, p[0], p[1]),
			named(["add", "remove"], p[2]),
			ref(context, "state", p[3]),
		]),
	],
	[314, simple("recoverAll", 2, (p, context) => [actorTarget(context, p[0], p[1])])],
	[315, changeActorGrowth("changeExp")],
	[316, changeActorGrowth("changeLevel")],
	[
		317,
		simple("changeParameter", 6, (p, context) => [
			actorTarget(context, p[0], p[1]),
			named(PARAMETERS, p[2]),
			amount(context, p[3], p[4], p[5]),
		]),
	],
	[
		318,
		simple("changeSkill", 4, (p, context) => [
			actorTarget(context, p[0], p[1]),
			named(["learn", "forget"], p[2]),
			ref(context, "skill", p[3]),
		]),
	],
	[319, simple("changeEquipment", 3, equipmentArgs)],
	[320, changeActorText("changeName")],
	[
		321,
		simple("changeClass", 3, (p, context) =>
			withOptions(
				[ref(context, "actor", p[0]), ref(context, "class", p[1])],
				flag("keepExp", p[2]),
			),
		),
	],
	[
		322,
		simple("changeActorImages", 6, (p, context) => [
			ref(context, "actor", p[0]),
			text(p[1]),
			number(p[2]),
			text(p[3]),
			number(p[4]),
			text(p[5]),
		]),
	],
	[323, simple("changeVehicleImage", 3, (p) => [named(VEHICLES, p[0]), text(p[1]), number(p[2])])],
	[324, changeActorText("changeNickname")],
	[325, changeActorText("changeProfile")],
	[326, changeActorValue("changeTp")],
	// Enemy
	[
		331,
		simple("changeEnemyHp", 5, (p, context) =>
			withOptions(
				[enemyTarget(p[0]), amount(context, p[1], p[2], p[3])],
				flag("allowKnockout", p[4]),
			),
		),
	],
	[332, changeEnemyValue("changeEnemyMp")],
	[
		333,
		simple("changeEnemyState", 3, (p, context) => [
			enemyTarget(p[0]),
			named(["add", "remove"], p[1]),
			ref(context, "state", p[2]),
		]),
	],
	[334, simple("enemyRecoverAll", 1, (p) => [enemyTarget(p[0])])],
	[335, simple("enemyAppear", 1, (p) => [enemyTarget(p[0])])],
	[
		336,
		simple("enemyTransform", 2, (p, context) => [enemyTarget(p[0]), ref(context, "enemy", p[1])]),
	],
	[337, simple("showBattleAnimation", 3, battleAnimationArgs)],
	[339, simple("forceAction", 4, forceActionArgs)],
	[340, simple("abortBattle", 0)],
	[342, changeEnemyValue("changeEnemyTp")],
];
