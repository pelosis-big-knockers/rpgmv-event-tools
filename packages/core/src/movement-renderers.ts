/**
 * Renderers for movement, characters, screen effects, audio and pictures (spec section 8.3,
 * #43): move routes, transfers and event locations, animations and balloons, waits, screen
 * tints, flashes, shakes and weather, BGM, BGS, ME, SE and movies, and pictures.
 *
 * Each renderer prints a command only when its parameters are exactly what the syntax
 * reproduces (their count, types and key order included), and otherwise declines so the raw
 * fallback keeps the command as it is.
 */
import { getMoveCommandInfo } from "./commands.js";
import type { NamedKind } from "./names.js";
import type { CommandRenderer, RenderContext } from "./renderers.js";
import {
	arrayLiteral,
	booleanLiteral,
	builderChain,
	call,
	computedMember,
	identifier,
	numberLiteral,
	objectLiteral,
	scriptString,
	statement,
	symbolReference,
	type Expr,
} from "./script-docs.js";

type Option = readonly [key: string, value: Expr];

const DIRECTIONS: Record<number, string> = { 2: "down", 4: "left", 6: "right", 8: "up" };
const FADES: Record<number, string> = { 0: "black", 1: "white", 2: "none" };
const VEHICLES: Record<number, string> = { 0: "boat", 1: "ship", 2: "airship" };
const BALLOONS: Record<number, string> = {
	1: "exclamation",
	2: "question",
	3: "musicNote",
	4: "heart",
	5: "anger",
	6: "sweat",
	7: "cobweb",
	8: "silence",
	9: "lightBulb",
	10: "zzz",
};
const ORIGINS: Record<number, string> = { 0: "upperLeft", 1: "center" };
const BLEND_MODES: Record<number, string> = {
	0: "normal",
	1: "additive",
	2: "multiply",
	3: "screen",
};
/** The keys of an audio parameter, in the order MV stores them. */
const AUDIO_KEYS = ["name", "volume", "pitch", "pan"];
/** The keys of a move route, in the order MV stores them. */
const ROUTE_KEYS = ["list", "repeat", "skippable", "wait"];

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

/** A number that prints as itself: finite, and not `-0` (which would print as `0`). */
function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

/** Text a script string can hold: a string without line breaks (see spec 4.4). */
function isText(value: unknown): value is string {
	return typeof value === "string" && !/[\r\n]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` has exactly the keys `keys`, in that order. */
function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const own = Object.keys(value);
	return own.length === keys.length && own.every((key, index) => key === keys[index]);
}

/** Whether two JSON values are identical, including key order and the sign of zero. */
function sameJson(a: unknown, b: unknown): boolean {
	if (Array.isArray(a)) {
		return (
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((element, index) => sameJson(element, b[index]))
		);
	}
	if (isRecord(a)) {
		return (
			isRecord(b) &&
			hasKeys(b, Object.keys(a)) &&
			Object.keys(a).every((key) => sameJson(a[key], b[key]))
		);
	}
	return Object.is(a, b);
}

/** An enum value by its name, or as a number when it has none (spec 5.7). */
function enumValue(names: Readonly<Record<number, string>>, value: unknown): Expr | undefined {
	if (!isNumber(value)) {
		return undefined;
	}
	const name = names[value];
	return name === undefined ? numberLiteral(value) : scriptString(name);
}

/** An option, or `undefined` when `value` is its default. */
function option(
	key: string,
	value: unknown,
	defaultValue: unknown,
	print: Expr,
): Option | undefined {
	return value === defaultValue ? undefined : [key, print];
}

/** A boolean `wait` option, left out at its default. */
function waitOption(wait: boolean, defaultValue: boolean): Option | undefined {
	return option("wait", wait, defaultValue, booleanLiteral(wait));
}

/** `args`, then an options object of the options that are set, if any. */
function withOptions(args: readonly Expr[], options: readonly (Option | undefined)[]): Expr[] {
	const set = options.filter((entry) => entry !== undefined);
	return set.length > 0 ? [...args, objectLiteral(set)] : [...args];
}

/** `name(args);`, or `undefined` if an argument is missing. */
function callStatement(name: string, args: readonly (Expr | undefined)[]) {
	return args.every((arg) => arg !== undefined) ? statement(call(name, args)) : undefined;
}

/** A tone or color, `[r, g, b, gray]` or `[r, g, b, strength]`. */
function colorArray(value: unknown): Expr | undefined {
	return Array.isArray(value) && value.length === 4 && value.every(isNumber)
		? arrayLiteral(value.map(numberLiteral))
		: undefined;
}

/**
 * An audio parameter, `{ name, volume, pitch, pan }`: the name, and options for the values that
 * aren't MV's defaults (volume 90, pitch 100, pan 0).
 */
function audio(value: unknown): [name: Expr, options: Option[]] | undefined {
	if (!isRecord(value) || !hasKeys(value, AUDIO_KEYS)) {
		return undefined;
	}
	const { name, volume, pitch, pan } = value;
	if (!isText(name) || !isNumber(volume) || !isNumber(pitch) || !isNumber(pan)) {
		return undefined;
	}
	const options = [
		option("volume", volume, 90, numberLiteral(volume)),
		option("pitch", pitch, 100, numberLiteral(pitch)),
		option("pan", pan, 0, numberLiteral(pan)),
	].filter((entry) => entry !== undefined);
	return [scriptString(name), options];
}

/**
 * A position given directly or by variables (spec 5.6): `x, y` for designation 0, and
 * `variables.X, variables.Y` for designation 1.
 */
function position(
	context: RenderContext,
	designation: unknown,
	x: unknown,
	y: unknown,
): [Expr, Expr] | undefined {
	if (designation === 0) {
		return isNumber(x) && isNumber(y) ? [numberLiteral(x), numberLiteral(y)] : undefined;
	}
	const left = designation === 1 ? ref(context, "variable", x) : undefined;
	const right = designation === 1 ? ref(context, "variable", y) : undefined;
	return left && right ? [left, right] : undefined;
}

/**
 * The `direction` option of a transfer or location, as a list: empty for the default 0
 * ("retain"), and `undefined` if `direction` isn't a number.
 */
function directionOption(direction: unknown): Option[] | undefined {
	const value = enumValue(DIRECTIONS, direction);
	return value && (direction === 0 ? [] : [["direction", value]]);
}

/** A map given directly (`maps.Forest`) or by a variable (`maps[variables.To_map]`). */
function mapTarget(context: RenderContext, designation: unknown, id: unknown): Expr | undefined {
	if (designation === 0) {
		return ref(context, "map", id);
	}
	const variable = designation === 1 ? ref(context, "variable", id) : undefined;
	return variable && computedMember(identifier("maps"), variable);
}

/** A command without parameters, printed as `name();`. */
function noParameters(name: string): CommandRenderer {
	return (node, context) =>
		params(node, context).length === 0 ? statement(call(name, [])) : undefined;
}

/** A command with one number, printed as `name(n);`. */
function oneNumber(name: string): CommandRenderer {
	return (node, context) => {
		const p = params(node, context);
		return p.length === 1 && isNumber(p[0])
			? statement(call(name, [numberLiteral(p[0])]))
			: undefined;
	};
}

/** A command with one ON/OFF value (0 ON, 1 OFF), printed as `name(true);` for ON. */
function onOff(name: string): CommandRenderer {
	return (node, context) => {
		const p = params(node, context);
		const [value] = p;
		return p.length === 1 && (value === 0 || value === 1)
			? statement(call(name, [booleanLiteral(value === 0)]))
			: undefined;
	};
}

/** A command with one audio parameter: `playSe("Door1", { volume: 80 });`. */
function playAudio(name: string): CommandRenderer {
	return (node, context) => {
		const p = params(node, context);
		const parsed = p.length === 1 ? audio(p[0]) : undefined;
		return parsed && statement(call(name, withOptions([parsed[0]], parsed[1])));
	};
}

/** 201: `transferPlayer(maps.Forest, 10, 5, { direction: "up", fade: "white" });`. */
const transferPlayer: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [designation, mapId, x, y, direction, fade] = p;
	const map = mapTarget(context, designation, mapId);
	const at = position(context, designation, x, y);
	const directionOptions = directionOption(direction);
	const fadeValue = enumValue(FADES, fade);
	if (p.length !== 6 || !map || !at || !directionOptions || !fadeValue) {
		return undefined;
	}
	const options = [...directionOptions, option("fade", fade, 0, fadeValue)];
	return statement(call("transferPlayer", withOptions([map, ...at], options)));
};

/** 202: `setVehicleLocation("boat", maps.Harbor, 4, 9);`. */
const setVehicleLocation: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [vehicle, designation, mapId, x, y] = p;
	const at = position(context, designation, x, y);
	if (p.length !== 5 || !at) {
		return undefined;
	}
	return callStatement("setVehicleLocation", [
		enumValue(VEHICLES, vehicle),
		mapTarget(context, designation, mapId),
		...at,
	]);
};

/**
 * 203: `setEventLocation(character, 3, 4, { direction: "down" });`, with variables for the
 * position, or `setEventLocation(character, { swapWith: character })` to swap places.
 */
const setEventLocation: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, designation, x, y, direction] = p;
	const target = context.character(id);
	const directionOptions = directionOption(direction);
	if (p.length !== 5 || !target || !directionOptions) {
		return undefined;
	}
	if (designation === 2) {
		// Swapping reads only the other character; the editor stores 0 as the y.
		const other = y === 0 ? context.character(x) : undefined;
		return (
			other &&
			statement(
				call("setEventLocation", [
					target,
					objectLiteral([["swapWith", other], ...directionOptions]),
				]),
			)
		);
	}
	const at = position(context, designation, x, y);
	return at && statement(call("setEventLocation", withOptions([target, ...at], directionOptions)));
};

/** 204: `scrollMap("up", 5, { speed: 4 });`. */
const scrollMap: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [direction, distance, speed] = p;
	const directionValue = enumValue(DIRECTIONS, direction);
	if (p.length !== 3 || !directionValue || !isNumber(distance) || !isNumber(speed)) {
		return undefined;
	}
	return statement(
		call(
			"scrollMap",
			withOptions(
				[directionValue, numberLiteral(distance)],
				[option("speed", speed, 4, numberLiteral(speed))],
			),
		),
	);
};

/** 212: `showAnimation(character, animations.Slash, { wait: true });`. */
const showAnimation: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, animationId, wait] = p;
	if (p.length !== 3 || typeof wait !== "boolean") {
		return undefined;
	}
	const target = context.character(id);
	const animation = ref(context, "animation", animationId);
	return (
		target &&
		animation &&
		statement(call("showAnimation", withOptions([target, animation], [waitOption(wait, false)])))
	);
};

/** 213: `showBalloonIcon(character, "exclamation", { wait: true });`. */
const showBalloonIcon: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, balloon, wait] = p;
	if (p.length !== 3 || typeof wait !== "boolean") {
		return undefined;
	}
	const target = context.character(id);
	const balloonValue = enumValue(BALLOONS, balloon);
	return (
		target &&
		balloonValue &&
		statement(
			call("showBalloonIcon", withOptions([target, balloonValue], [waitOption(wait, false)])),
		)
	);
};

/**
 * A screen effect with a color or tone, a duration and a wait flag (default on):
 * `tintScreen([-68, -68, 0, 68], 60);`.
 */
function colorEffect(name: string): CommandRenderer {
	return (node, context) => {
		const p = params(node, context);
		const [color, duration, wait] = p;
		const colorValue = colorArray(color);
		if (p.length !== 3 || !colorValue || !isNumber(duration) || typeof wait !== "boolean") {
			return undefined;
		}
		return statement(
			call(name, withOptions([colorValue, numberLiteral(duration)], [waitOption(wait, true)])),
		);
	};
}

/** 225: `shakeScreen(5, 5, 30, { wait: false });` (power, speed, frames). */
const shakeScreen: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [power, speed, duration, wait] = p;
	if (
		p.length !== 4 ||
		!isNumber(power) ||
		!isNumber(speed) ||
		!isNumber(duration) ||
		typeof wait !== "boolean"
	) {
		return undefined;
	}
	const args = [numberLiteral(power), numberLiteral(speed), numberLiteral(duration)];
	return statement(call("shakeScreen", withOptions(args, [waitOption(wait, true)])));
};

/** 236: `setWeatherEffect("rain", 5, 60);` (type, power, frames). */
const setWeatherEffect: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [type, power, duration, wait] = p;
	if (
		p.length !== 4 ||
		!isText(type) ||
		!isNumber(power) ||
		!isNumber(duration) ||
		typeof wait !== "boolean"
	) {
		return undefined;
	}
	const args = [scriptString(type), numberLiteral(power), numberLiteral(duration)];
	return statement(call("setWeatherEffect", withOptions(args, [waitOption(wait, true)])));
};

/** 261: `playMovie("Intro");`. */
const playMovie: CommandRenderer = (node, context) => {
	const p = params(node, context);
	return p.length === 1 && isText(p[0])
		? statement(call("playMovie", [scriptString(p[0])]))
		: undefined;
};

/** The picture options shared by Show Picture and Move Picture, left out at their defaults. */
function pictureOptions(
	origin: unknown,
	scaleX: unknown,
	scaleY: unknown,
	opacity: unknown,
	blendMode: unknown,
): (Option | undefined)[] | undefined {
	const originValue = enumValue(ORIGINS, origin);
	const blendValue = enumValue(BLEND_MODES, blendMode);
	if (!originValue || !blendValue || !isNumber(scaleX) || !isNumber(scaleY) || !isNumber(opacity)) {
		return undefined;
	}
	return [
		option("origin", origin, 0, originValue),
		option("scaleX", scaleX, 100, numberLiteral(scaleX)),
		option("scaleY", scaleY, 100, numberLiteral(scaleY)),
		option("opacity", opacity, 255, numberLiteral(opacity)),
		option("blendMode", blendMode, 0, blendValue),
	];
}

/** 231: `showPicture(1, "Overlay", 0, 0, { opacity: 200 });`. */
const showPicture: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, name, origin, designation, x, y, scaleX, scaleY, opacity, blendMode] = p;
	const at = position(context, designation, x, y);
	const options = pictureOptions(origin, scaleX, scaleY, opacity, blendMode);
	if (p.length !== 10 || !isIndex(id) || !isText(name) || !at || !options) {
		return undefined;
	}
	return statement(
		call("showPicture", withOptions([numberLiteral(id), scriptString(name), ...at], options)),
	);
};

/** 232: `movePicture(1, 0, 0, 60, { opacity: 0, wait: false });` (x, y, frames). */
const movePicture: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, unused, origin, designation, x, y, scaleX, scaleY, opacity, blendMode] = p;
	const [duration, wait] = p.slice(10);
	const at = position(context, designation, x, y);
	const options = pictureOptions(origin, scaleX, scaleY, opacity, blendMode);
	if (
		p.length !== 12 ||
		!isIndex(id) ||
		unused !== 0 ||
		!at ||
		!options ||
		!isNumber(duration) ||
		typeof wait !== "boolean"
	) {
		return undefined;
	}
	const args = [numberLiteral(id), ...at, numberLiteral(duration)];
	return statement(call("movePicture", withOptions(args, [...options, waitOption(wait, true)])));
};

/** 233: `rotatePicture(1, 5);` (speed). */
const rotatePicture: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, speed] = p;
	return p.length === 2 && isIndex(id) && isNumber(speed)
		? statement(call("rotatePicture", [numberLiteral(id), numberLiteral(speed)]))
		: undefined;
};

/** 234: `tintPicture(1, [0, 0, 0, 255], 60);` (tone, frames). */
const tintPicture: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, tone, duration, wait] = p;
	const toneValue = colorArray(tone);
	if (
		p.length !== 4 ||
		!isIndex(id) ||
		!toneValue ||
		!isNumber(duration) ||
		typeof wait !== "boolean"
	) {
		return undefined;
	}
	const args = [numberLiteral(id), toneValue, numberLiteral(duration)];
	return statement(call("tintPicture", withOptions(args, [waitOption(wait, true)])));
};

/** 235: `erasePicture(1);`. */
const erasePicture: CommandRenderer = (node, context) => {
	const p = params(node, context);
	return p.length === 1 && isIndex(p[0])
		? statement(call("erasePicture", [numberLiteral(p[0])]))
		: undefined;
};

/** A move route step's arguments, and its options (Play SE's audio options). */
interface StepArguments {
	readonly args: readonly Expr[];
	readonly options?: readonly Option[];
}

/**
 * The arguments of a move route step with parameters, by step code, or `undefined` if the
 * parameters aren't exactly what the step takes.
 */
const STEP_ARGUMENTS: Readonly<
	Record<number, (p: readonly unknown[], context: RenderContext) => StepArguments | undefined>
> = {
	14: (p) => (p.length === 2 && p.every(isNumber) ? { args: p.map(numberLiteral) } : undefined),
	15: stepNumber,
	27: stepSwitch,
	28: stepSwitch,
	29: stepNumber,
	30: stepNumber,
	41: (p) => {
		const [name, index] = p;
		return p.length === 2 && isText(name) && isNumber(index)
			? { args: [scriptString(name), numberLiteral(index)] }
			: undefined;
	},
	42: stepNumber,
	43: (p) => {
		const blendMode = p.length === 1 ? enumValue(BLEND_MODES, p[0]) : undefined;
		return blendMode && { args: [blendMode] };
	},
	44: (p) => {
		const parsed = p.length === 1 ? audio(p[0]) : undefined;
		return parsed && { args: [parsed[0]], options: parsed[1] };
	},
	45: (p) => (p.length === 1 && isText(p[0]) ? { args: [scriptString(p[0])] } : undefined),
};

function stepNumber(p: readonly unknown[]): StepArguments | undefined {
	return p.length === 1 && isNumber(p[0]) ? { args: [numberLiteral(p[0])] } : undefined;
}

function stepSwitch(p: readonly unknown[], context: RenderContext): StepArguments | undefined {
	const target = p.length === 1 ? ref(context, "switch", p[0]) : undefined;
	return target && { args: [target] };
}

/**
 * One step of a move route as a call of the chain: `moveUp()`, `wait(15)`, and so on. A step is
 * `{ code, indent }`, or `{ code, parameters, indent }` for steps with parameters, and its indent
 * is `null`, or `0` printed as the option `{ indent: 0 }`.
 */
function routeStep(
	step: unknown,
	context: RenderContext,
): readonly [name: string, args: readonly Expr[]] | undefined {
	if (!isRecord(step) || typeof step.code !== "number" || step.code === 0) {
		return undefined;
	}
	const info = getMoveCommandInfo(step.code);
	if (!info || (step.indent !== null && step.indent !== 0)) {
		return undefined;
	}
	const parse = STEP_ARGUMENTS[step.code];
	let parsed: StepArguments | undefined;
	if (parse) {
		const { parameters } = step;
		parsed =
			hasKeys(step, ["code", "parameters", "indent"]) && Array.isArray(parameters)
				? parse(parameters, context)
				: undefined;
	} else {
		parsed = hasKeys(step, ["code", "indent"]) ? { args: [] } : undefined;
	}
	if (!parsed) {
		return undefined;
	}
	const indent: Option | undefined = step.indent === 0 ? ["indent", numberLiteral(0)] : undefined;
	return [info.name, withOptions(parsed.args, [...(parsed.options ?? []), indent])];
}

/**
 * 205 + 505: `setMovementRoute(character, { skippable: true }).moveUp().wait(15);`. The route is
 * `{ list, repeat, skippable, wait }`, its list ends with `{ code: 0 }`, and the 505 lines after
 * the command are exact copies of its steps, which the compiler regenerates.
 */
const setMovementRoute: CommandRenderer = (node, context) => {
	const p = params(node, context);
	const [id, route] = p;
	if (p.length !== 2 || !isRecord(route) || !hasKeys(route, ROUTE_KEYS)) {
		return undefined;
	}
	const { list, repeat, skippable, wait } = route;
	if (
		!Array.isArray(list) ||
		typeof repeat !== "boolean" ||
		typeof skippable !== "boolean" ||
		typeof wait !== "boolean"
	) {
		return undefined;
	}
	const end: unknown = list.at(-1);
	if (!isRecord(end) || !hasKeys(end, ["code"]) || end.code !== 0) {
		return undefined;
	}
	const steps: unknown[] = list.slice(0, -1);
	if (node.end - node.start - 1 !== steps.length) {
		return undefined;
	}
	for (const [index, step] of steps.entries()) {
		const copy = context.list[node.start + 1 + index]?.parameters;
		if (copy?.length !== 1 || !sameJson(copy[0], step)) {
			return undefined;
		}
	}
	const calls: (readonly [string, readonly Expr[]])[] = [];
	for (const step of steps) {
		const printed = routeStep(step, context);
		if (!printed) {
			return undefined;
		}
		calls.push(printed);
	}
	const target = context.character(id);
	if (!target) {
		return undefined;
	}
	const head = call(
		"setMovementRoute",
		withOptions(
			[target],
			[
				option("repeat", repeat, false, booleanLiteral(repeat)),
				option("skippable", skippable, false, booleanLiteral(skippable)),
				waitOption(wait, true),
			],
		),
	);
	return statement(builderChain(head, calls));
};

export const MOVEMENT_RENDERERS: readonly (readonly [number, CommandRenderer])[] = [
	[201, transferPlayer],
	[202, setVehicleLocation],
	[203, setEventLocation],
	[204, scrollMap],
	[205, setMovementRoute],
	[206, noParameters("getOnOffVehicle")],
	[211, onOff("changeTransparency")],
	[212, showAnimation],
	[213, showBalloonIcon],
	[214, noParameters("eraseEvent")],
	[216, onOff("changePlayerFollowers")],
	[217, noParameters("gatherFollowers")],
	[221, noParameters("fadeoutScreen")],
	[222, noParameters("fadeinScreen")],
	[223, colorEffect("tintScreen")],
	[224, colorEffect("flashScreen")],
	[225, shakeScreen],
	[230, oneNumber("wait")],
	[231, showPicture],
	[232, movePicture],
	[233, rotatePicture],
	[234, tintPicture],
	[235, erasePicture],
	[236, setWeatherEffect],
	[241, playAudio("playBgm")],
	[242, oneNumber("fadeoutBgm")],
	[243, noParameters("saveBgm")],
	[244, noParameters("replayBgm")],
	[245, playAudio("playBgs")],
	[246, oneNumber("fadeoutBgs")],
	[249, playAudio("playMe")],
	[250, playAudio("playSe")],
	[251, noParameters("stopSe")],
	[261, playMovie],
];
