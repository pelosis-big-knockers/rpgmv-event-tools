/**
 * Catalog of RPG Maker MV event commands: what each command code means, what its parameters
 * are, and how it fits into the structure of a command list.
 *
 * Parameter meanings follow `Game_Interpreter` in MV's `rpg_objects.js` (v1.6), plus the codes
 * the editor writes that the interpreter has no `commandNNN` method for (text lines, block ends
 * and so on).
 */

/** One entry in an event's command list. */
export interface EventCommand {
	code: number;
	/** Nesting depth. Commands inside a branch or loop are one level deeper than its header. */
	indent: number;
	parameters: unknown[];
}

/**
 * One step of a move route. Steps without parameters sometimes omit `parameters` entirely, and
 * `indent` is usually `null`.
 */
export interface MoveCommand {
	code: number;
	indent?: number | null;
	parameters?: unknown[];
}

/**
 * How a command fits into a command list's structure.
 *
 * - `command`: stands alone.
 * - `opensBlock`: starts a block whose branches and end are listed with `of` pointing back to it
 *   (choices, conditional branch, loop, battle processing).
 * - `continuation`: an extra line of the command before it (for example text lines after
 *   Show Text). It always follows its `of` command or another continuation of the same kind.
 * - `branch`: starts a branch of an `of` block (When, Else, If Win, …). The branch body is one
 *   indent level deeper.
 * - `closesBlock`: ends an `of` block.
 * - `end`: code 0. Ends a branch body, and the whole list.
 */
export type CommandRole =
	| { kind: "command" }
	| { kind: "opensBlock" }
	| { kind: "continuation"; of: number }
	| { kind: "branch"; of: number }
	| { kind: "closesBlock"; of: number }
	| { kind: "end" };

/** Groups matching the tabs of the MV editor's command dialog, plus editor-only structure codes. */
export type CommandCategory =
	| "message"
	| "gameProgression"
	| "flowControl"
	| "party"
	| "actor"
	| "movement"
	| "character"
	| "picture"
	| "timing"
	| "screen"
	| "audioVideo"
	| "sceneControl"
	| "systemSettings"
	| "map"
	| "battle"
	| "advanced"
	| "structure";

/**
 * What a parameter holds. Ids of database entries name their database. Parameters whose meaning
 * depends on another parameter (for example "a constant or a variable id") are `int` or `any`,
 * with the rule in `description`.
 */
export type ParameterType =
	| "int"
	| "bool"
	| "string"
	| "enum"
	| "switchId"
	| "variableId"
	| "selfSwitch"
	| "commonEventId"
	| "actorId"
	| "classId"
	| "skillId"
	| "itemId"
	| "weaponId"
	| "armorId"
	| "enemyId"
	| "troopId"
	| "stateId"
	| "animationId"
	| "tilesetId"
	| "mapId"
	| "character"
	| "enemyIndex"
	| "pictureId"
	| "audio"
	| "tone"
	| "color"
	| "moveRoute"
	| "moveCommand"
	| "choices"
	| "script"
	| "any";

export interface ParameterInfo {
	name: string;
	type: ParameterType;
	description?: string;
	/** Meanings of the values of an `enum` parameter. */
	values?: Readonly<Record<number | string, string>>;
}

export interface CommandInfo {
	code: number;
	/** A stable identifier, for example `showText`. */
	name: string;
	/** The name shown in the MV editor, for example `Show Text`. */
	label: string;
	category: CommandCategory;
	role: CommandRole;
	/** Parameters by position. Later positions may be missing in data from older MV versions. */
	parameters: readonly ParameterInfo[];
}

export interface MoveCommandInfo {
	code: number;
	name: string;
	label: string;
	parameters: readonly ParameterInfo[];
}

// Shared value tables.
const ON_OFF = { 0: "ON", 1: "OFF" };
const DISABLE_ENABLE = { 0: "disable", 1: "enable" };
const ADD_REMOVE = { 0: "add", 1: "remove" };
const INCREASE_DECREASE = { 0: "increase", 1: "decrease" };
const CONSTANT_VARIABLE = { 0: "constant", 1: "variable" };
const DIRECT_VARIABLES = { 0: "direct", 1: "variables" };
const ACTOR_DESIGNATION = { 0: "fixed", 1: "variable" };
const DIRECTION = { 0: "retain", 2: "down", 4: "left", 6: "right", 8: "up" };
const VEHICLE = { 0: "boat", 1: "ship", 2: "airship" };
const BLEND_MODE = { 0: "normal", 1: "additive", 2: "multiply", 3: "screen" };
const PICTURE_ORIGIN = { 0: "upperLeft", 1: "center" };

function param(
	name: string,
	type: ParameterType,
	description?: string,
	values?: Readonly<Record<number | string, string>>,
): ParameterInfo {
	return {
		name,
		type,
		...(description === undefined ? {} : { description }),
		...(values === undefined ? {} : { values }),
	};
}

function choice(
	name: string,
	values: Readonly<Record<number | string, string>>,
	description?: string,
): ParameterInfo {
	return param(name, "enum", description, values);
}

const COMMAND: CommandRole = { kind: "command" };
const OPENS_BLOCK: CommandRole = { kind: "opensBlock" };
const continuationOf = (of: number): CommandRole => ({ kind: "continuation", of });
const branchOf = (of: number): CommandRole => ({ kind: "branch", of });
const closes = (of: number): CommandRole => ({ kind: "closesBlock", of });

function command(
	code: number,
	name: string,
	label: string,
	category: CommandCategory,
	parameters: readonly ParameterInfo[] = [],
	role: CommandRole = COMMAND,
): CommandInfo {
	return { code, name, label, category, role, parameters };
}

/** Parameters shared by Change HP, MP, TP, EXP, Level and similar actor commands. */
const actorTarget = [
	choice("actorDesignation", ACTOR_DESIGNATION),
	param(
		"actor",
		"int",
		"Actor ID (0 means the entire party) when actorDesignation is fixed, otherwise a variable ID holding the actor ID",
	),
];
/** The operation, operand type and operand used by Change Gold, Change Items and similar. */
const operateValue = [
	choice("operation", INCREASE_DECREASE),
	choice("operandType", CONSTANT_VARIABLE),
	param("operand", "int", "A constant, or a variable ID when operandType is variable"),
];
const enemyTarget = param(
	"enemyIndex",
	"enemyIndex",
	"Troop member index, or -1 for the entire troop",
);

const COMMANDS: readonly CommandInfo[] = [
	// Structure
	command(0, "end", "End", "structure", [], { kind: "end" }),

	// Message
	command(101, "showText", "Show Text", "message", [
		param("faceName", "string", "Face image file name, or empty for no face"),
		param("faceIndex", "int", "Index of the face within the face image (0-7)"),
		choice("background", { 0: "window", 1: "dim", 2: "transparent" }),
		choice("position", { 0: "top", 1: "middle", 2: "bottom" }),
	]),
	command(401, "textLine", "Text", "message", [param("text", "string")], continuationOf(101)),
	command(
		102,
		"showChoices",
		"Show Choices",
		"message",
		[
			param("choices", "choices", "The choice texts"),
			param(
				"cancelType",
				"int",
				"Index of the choice taken on cancel; -1 disallows cancel, and a value at or beyond the number of choices gives cancel its own When Cancel branch",
			),
			param("defaultType", "int", "Index of the initially selected choice, or -1 for none"),
			choice("position", { 0: "left", 1: "middle", 2: "right" }),
			choice("background", { 0: "window", 1: "dim", 2: "transparent" }),
		],
		OPENS_BLOCK,
	),
	command(
		402,
		"whenChoice",
		"When",
		"message",
		[
			param("choiceIndex", "int"),
			param("choiceText", "string", "Copy of the choice text, for display"),
		],
		branchOf(102),
	),
	command(
		403,
		"whenCancel",
		"When Cancel",
		"message",
		[
			param("choiceIndex", "int", "Not read by the interpreter"),
			param("choiceText", "any", "Not read by the interpreter"),
		],
		branchOf(102),
	),
	command(404, "endChoices", "End Choices", "message", [], closes(102)),
	command(103, "inputNumber", "Input Number", "message", [
		param("variableId", "variableId", "Variable that receives the number"),
		param("digits", "int"),
	]),
	command(104, "selectItem", "Select Item", "message", [
		param("variableId", "variableId", "Variable that receives the selected item ID"),
		choice("itemType", { 1: "regularItem", 2: "keyItem", 3: "hiddenItemA", 4: "hiddenItemB" }),
	]),
	command(105, "showScrollingText", "Show Scrolling Text", "message", [
		param("speed", "int"),
		param("noFastForward", "bool"),
	]),
	command(
		405,
		"scrollingTextLine",
		"Scrolling Text",
		"message",
		[param("text", "string")],
		continuationOf(105),
	),

	// Game progression
	command(121, "controlSwitches", "Control Switches", "gameProgression", [
		param("startId", "switchId"),
		param("endId", "switchId", "Last switch in the range; equal to startId for a single switch"),
		choice("value", ON_OFF),
	]),
	command(122, "controlVariables", "Control Variables", "gameProgression", [
		param("startId", "variableId"),
		param(
			"endId",
			"variableId",
			"Last variable in the range; equal to startId for a single variable",
		),
		choice("operation", { 0: "set", 1: "add", 2: "sub", 3: "mul", 4: "div", 5: "mod" }),
		choice("operandType", {
			0: "constant",
			1: "variable",
			2: "random",
			3: "gameData",
			4: "script",
		}),
		param(
			"operand",
			"any",
			"By operandType: the constant, a variable ID, the random minimum, the game data type (0 item, 1 weapon, 2 armor, 3 actor, 4 enemy, 5 character, 6 party, 7 other), or the script",
		),
		param(
			"operand2",
			"int",
			"Random maximum, or the first game data argument (for example the item or actor ID)",
		),
		param("operand3", "int", "Second game data argument (for example which actor stat)"),
	]),
	command(123, "controlSelfSwitch", "Control Self Switch", "gameProgression", [
		param("selfSwitch", "selfSwitch", "A, B, C or D"),
		choice("value", ON_OFF),
	]),
	command(124, "controlTimer", "Control Timer", "gameProgression", [
		choice("operation", { 0: "start", 1: "stop" }),
		param("seconds", "int"),
	]),

	// Flow control
	command(108, "comment", "Comment", "flowControl", [
		param("text", "string", "First line of the comment"),
	]),
	command(
		408,
		"commentLine",
		"Comment",
		"flowControl",
		[param("text", "string")],
		continuationOf(108),
	),
	command(
		111,
		"conditionalBranch",
		"Conditional Branch",
		"flowControl",
		[
			choice("conditionType", {
				0: "switch",
				1: "variable",
				2: "selfSwitch",
				3: "timer",
				4: "actor",
				5: "enemy",
				6: "character",
				7: "gold",
				8: "item",
				9: "weapon",
				10: "armor",
				11: "button",
				12: "script",
				13: "vehicle",
			}),
			param(
				"arg1",
				"any",
				"By conditionType: switch ID, variable ID, self switch letter, timer seconds, actor ID, enemy index, character, gold amount, item/weapon/armor ID, button name, script, or vehicle",
			),
			param(
				"arg2",
				"any",
				"By conditionType: 0 ON / 1 OFF for switches, operand type for variables (0 constant, 1 variable), timer comparison (0 ≥, 1 ≤), actor check (0 in party, 1 name, 2 class, 3 skill, 4 weapon, 5 armor, 6 state), enemy check (0 appeared, 1 state), direction, gold comparison (0 ≥, 1 ≤, 2 <), or whether to include equipment",
			),
			param(
				"arg3",
				"any",
				"For variables, the constant or variable ID to compare with; for actor and enemy checks, the value to check",
			),
			param("arg4", "any", "For variables, the comparison: 0 =, 1 ≥, 2 ≤, 3 >, 4 <, 5 ≠"),
		],
		OPENS_BLOCK,
	),
	command(411, "else", "Else", "flowControl", [], branchOf(111)),
	command(412, "endBranch", "End Branch", "flowControl", [], closes(111)),
	command(112, "loop", "Loop", "flowControl", [], OPENS_BLOCK),
	command(413, "repeatAbove", "Repeat Above", "flowControl", [], closes(112)),
	command(113, "breakLoop", "Break Loop", "flowControl"),
	command(115, "exitEventProcessing", "Exit Event Processing", "flowControl"),
	command(117, "commonEvent", "Common Event", "flowControl", [
		param("commonEventId", "commonEventId"),
	]),
	command(118, "label", "Label", "flowControl", [param("name", "string")]),
	command(119, "jumpToLabel", "Jump to Label", "flowControl", [param("name", "string")]),

	// Party
	command(125, "changeGold", "Change Gold", "party", operateValue),
	command(126, "changeItems", "Change Items", "party", [
		param("itemId", "itemId"),
		...operateValue,
	]),
	command(127, "changeWeapons", "Change Weapons", "party", [
		param("weaponId", "weaponId"),
		...operateValue,
		param("includeEquipment", "bool", "When decreasing, also remove equipped weapons"),
	]),
	command(128, "changeArmors", "Change Armors", "party", [
		param("armorId", "armorId"),
		...operateValue,
		param("includeEquipment", "bool", "When decreasing, also remove equipped armors"),
	]),
	command(129, "changePartyMember", "Change Party Member", "party", [
		param("actorId", "actorId"),
		choice("operation", ADD_REMOVE),
		param("initialize", "bool", "When adding, reset the actor to their initial state"),
	]),

	// Actor
	command(311, "changeHp", "Change HP", "actor", [
		...actorTarget,
		...operateValue,
		param("allowKnockout", "bool"),
	]),
	command(312, "changeMp", "Change MP", "actor", [...actorTarget, ...operateValue]),
	command(326, "changeTp", "Change TP", "actor", [...actorTarget, ...operateValue]),
	command(313, "changeState", "Change State", "actor", [
		...actorTarget,
		choice("operation", ADD_REMOVE),
		param("stateId", "stateId"),
	]),
	command(314, "recoverAll", "Recover All", "actor", actorTarget),
	command(315, "changeExp", "Change EXP", "actor", [
		...actorTarget,
		...operateValue,
		param("showLevelUp", "bool"),
	]),
	command(316, "changeLevel", "Change Level", "actor", [
		...actorTarget,
		...operateValue,
		param("showLevelUp", "bool"),
	]),
	command(317, "changeParameter", "Change Parameter", "actor", [
		...actorTarget,
		choice("parameter", {
			0: "maxHp",
			1: "maxMp",
			2: "attack",
			3: "defense",
			4: "magicAttack",
			5: "magicDefense",
			6: "agility",
			7: "luck",
		}),
		...operateValue,
	]),
	command(318, "changeSkill", "Change Skill", "actor", [
		...actorTarget,
		choice("operation", { 0: "learn", 1: "forget" }),
		param("skillId", "skillId"),
	]),
	command(319, "changeEquipment", "Change Equipment", "actor", [
		param("actorId", "actorId"),
		param("equipTypeId", "int", "Equipment slot type (1 is the weapon slot)"),
		param(
			"itemId",
			"int",
			"Weapon ID for the weapon slot, otherwise armor ID; 0 removes the equipment",
		),
	]),
	command(320, "changeName", "Change Name", "actor", [
		param("actorId", "actorId"),
		param("name", "string"),
	]),
	command(321, "changeClass", "Change Class", "actor", [
		param("actorId", "actorId"),
		param("classId", "classId"),
		param("keepExp", "bool"),
	]),
	command(324, "changeNickname", "Change Nickname", "actor", [
		param("actorId", "actorId"),
		param("nickname", "string"),
	]),
	command(325, "changeProfile", "Change Profile", "actor", [
		param("actorId", "actorId"),
		param("profile", "string"),
	]),

	// Movement
	command(201, "transferPlayer", "Transfer Player", "movement", [
		choice("designation", DIRECT_VARIABLES),
		param("mapId", "int", "Map ID, or a variable ID holding it when designation is variables"),
		param("x", "int", "X, or a variable ID holding it when designation is variables"),
		param("y", "int", "Y, or a variable ID holding it when designation is variables"),
		choice("direction", DIRECTION),
		choice("fadeType", { 0: "black", 1: "white", 2: "none" }),
	]),
	command(202, "setVehicleLocation", "Set Vehicle Location", "movement", [
		choice("vehicle", VEHICLE),
		choice("designation", DIRECT_VARIABLES),
		param("mapId", "int", "Map ID, or a variable ID holding it when designation is variables"),
		param("x", "int", "X, or a variable ID holding it when designation is variables"),
		param("y", "int", "Y, or a variable ID holding it when designation is variables"),
	]),
	command(203, "setEventLocation", "Set Event Location", "movement", [
		param("character", "character"),
		choice("designation", { 0: "direct", 1: "variables", 2: "exchange" }),
		param("x", "int", "X, a variable ID holding it, or the event to swap places with"),
		param("y", "int", "Y, or a variable ID holding it"),
		choice("direction", DIRECTION),
	]),
	command(204, "scrollMap", "Scroll Map", "movement", [
		choice("direction", { 2: "down", 4: "left", 6: "right", 8: "up" }),
		param("distance", "int"),
		param("speed", "int", "1 (slowest) to 6 (fastest)"),
	]),
	command(205, "setMovementRoute", "Set Movement Route", "movement", [
		param("character", "character"),
		param("moveRoute", "moveRoute", "The route: list, repeat, skippable and wait"),
	]),
	command(
		505,
		"movementRouteStep",
		"Movement Route Step",
		"movement",
		[param("moveCommand", "moveCommand", "Copy of one step of the route, for display")],
		continuationOf(205),
	),
	command(206, "getOnOffVehicle", "Get on/off Vehicle", "movement"),

	// Character
	command(211, "changeTransparency", "Change Transparency", "character", [choice("value", ON_OFF)]),
	command(216, "changePlayerFollowers", "Change Player Followers", "character", [
		choice("value", ON_OFF),
	]),
	command(217, "gatherFollowers", "Gather Followers", "character"),
	command(212, "showAnimation", "Show Animation", "character", [
		param("character", "character"),
		param("animationId", "animationId"),
		param("wait", "bool"),
	]),
	command(213, "showBalloonIcon", "Show Balloon Icon", "character", [
		param("character", "character"),
		param(
			"balloonId",
			"int",
			"1 exclamation, 2 question, 3 music note, 4 heart, 5 anger, 6 sweat, 7 cobweb, 8 silence, 9 light bulb, 10 zzz, 11-15 user defined",
		),
		param("wait", "bool"),
	]),
	command(214, "eraseEvent", "Erase Event", "character"),

	// Picture
	command(231, "showPicture", "Show Picture", "picture", [
		param("pictureId", "pictureId"),
		param("name", "string", "Picture file name"),
		choice("origin", PICTURE_ORIGIN),
		choice("designation", DIRECT_VARIABLES),
		param("x", "int", "X, or a variable ID holding it when designation is variables"),
		param("y", "int", "Y, or a variable ID holding it when designation is variables"),
		param("scaleX", "int", "Percent"),
		param("scaleY", "int", "Percent"),
		param("opacity", "int", "0-255"),
		choice("blendMode", BLEND_MODE),
	]),
	command(232, "movePicture", "Move Picture", "picture", [
		param("pictureId", "pictureId"),
		param("unused", "any", "Not read by the interpreter"),
		choice("origin", PICTURE_ORIGIN),
		choice("designation", DIRECT_VARIABLES),
		param("x", "int", "X, or a variable ID holding it when designation is variables"),
		param("y", "int", "Y, or a variable ID holding it when designation is variables"),
		param("scaleX", "int", "Percent"),
		param("scaleY", "int", "Percent"),
		param("opacity", "int", "0-255"),
		choice("blendMode", BLEND_MODE),
		param("duration", "int", "Frames"),
		param("wait", "bool"),
	]),
	command(233, "rotatePicture", "Rotate Picture", "picture", [
		param("pictureId", "pictureId"),
		param("speed", "int", "Negative values rotate counterclockwise"),
	]),
	command(234, "tintPicture", "Tint Picture", "picture", [
		param("pictureId", "pictureId"),
		param("tone", "tone"),
		param("duration", "int", "Frames"),
		param("wait", "bool"),
	]),
	command(235, "erasePicture", "Erase Picture", "picture", [param("pictureId", "pictureId")]),

	// Timing
	command(230, "wait", "Wait", "timing", [param("frames", "int")]),

	// Screen
	command(221, "fadeoutScreen", "Fadeout Screen", "screen"),
	command(222, "fadeinScreen", "Fadein Screen", "screen"),
	command(223, "tintScreen", "Tint Screen", "screen", [
		param("tone", "tone"),
		param("duration", "int", "Frames"),
		param("wait", "bool"),
	]),
	command(224, "flashScreen", "Flash Screen", "screen", [
		param("color", "color"),
		param("duration", "int", "Frames"),
		param("wait", "bool"),
	]),
	command(225, "shakeScreen", "Shake Screen", "screen", [
		param("power", "int", "1-9"),
		param("speed", "int", "1-9"),
		param("duration", "int", "Frames"),
		param("wait", "bool"),
	]),
	command(236, "setWeatherEffect", "Set Weather Effect", "screen", [
		choice("type", { none: "none", rain: "rain", storm: "storm", snow: "snow" }),
		param("power", "int", "1-9"),
		param("duration", "int", "Frames"),
		param("wait", "bool"),
	]),

	// Audio & video
	command(241, "playBgm", "Play BGM", "audioVideo", [param("audio", "audio")]),
	command(242, "fadeoutBgm", "Fadeout BGM", "audioVideo", [param("seconds", "int")]),
	command(243, "saveBgm", "Save BGM", "audioVideo"),
	command(244, "replayBgm", "Replay BGM", "audioVideo"),
	command(245, "playBgs", "Play BGS", "audioVideo", [param("audio", "audio")]),
	command(246, "fadeoutBgs", "Fadeout BGS", "audioVideo", [param("seconds", "int")]),
	command(249, "playMe", "Play ME", "audioVideo", [param("audio", "audio")]),
	command(250, "playSe", "Play SE", "audioVideo", [param("audio", "audio")]),
	command(251, "stopSe", "Stop SE", "audioVideo"),
	command(261, "playMovie", "Play Movie", "audioVideo", [
		param("name", "string", "Movie file name without extension"),
	]),

	// Scene control
	command(
		301,
		"battleProcessing",
		"Battle Processing",
		"sceneControl",
		[
			choice("designation", { 0: "direct", 1: "variable", 2: "randomEncounter" }),
			param("troop", "int", "Troop ID, or a variable ID holding it when designation is variable"),
			param("canEscape", "bool", "Adds an If Escape branch"),
			param("canLose", "bool", "Adds an If Lose branch"),
		],
		OPENS_BLOCK,
	),
	command(601, "ifWin", "If Win", "sceneControl", [], branchOf(301)),
	command(602, "ifEscape", "If Escape", "sceneControl", [], branchOf(301)),
	command(603, "ifLose", "If Lose", "sceneControl", [], branchOf(301)),
	command(604, "endBattleResult", "End", "sceneControl", [], closes(301)),
	command(302, "shopProcessing", "Shop Processing", "sceneControl", [
		choice("goodsType", { 0: "item", 1: "weapon", 2: "armor" }),
		param("goodsId", "int", "Item, weapon or armor ID, by goodsType"),
		choice("priceType", { 0: "standard", 1: "specified" }),
		param("price", "int"),
		param("purchaseOnly", "bool"),
	]),
	command(
		605,
		"shopItem",
		"Shop Item",
		"sceneControl",
		[
			choice("goodsType", { 0: "item", 1: "weapon", 2: "armor" }),
			param("goodsId", "int", "Item, weapon or armor ID, by goodsType"),
			choice("priceType", { 0: "standard", 1: "specified" }),
			param("price", "int"),
		],
		continuationOf(302),
	),
	command(303, "nameInputProcessing", "Name Input Processing", "sceneControl", [
		param("actorId", "actorId"),
		param("maxCharacters", "int"),
	]),
	command(351, "openMenuScreen", "Open Menu Screen", "sceneControl"),
	command(352, "openSaveScreen", "Open Save Screen", "sceneControl"),
	command(353, "gameOver", "Game Over", "sceneControl"),
	command(354, "returnToTitleScreen", "Return to Title Screen", "sceneControl"),

	// System settings
	command(132, "changeBattleBgm", "Change Battle BGM", "systemSettings", [param("audio", "audio")]),
	command(133, "changeVictoryMe", "Change Victory ME", "systemSettings", [param("audio", "audio")]),
	command(139, "changeDefeatMe", "Change Defeat ME", "systemSettings", [param("audio", "audio")]),
	command(140, "changeVehicleBgm", "Change Vehicle BGM", "systemSettings", [
		choice("vehicle", VEHICLE),
		param("audio", "audio"),
	]),
	command(134, "changeSaveAccess", "Change Save Access", "systemSettings", [
		choice("value", DISABLE_ENABLE),
	]),
	command(135, "changeMenuAccess", "Change Menu Access", "systemSettings", [
		choice("value", DISABLE_ENABLE),
	]),
	command(136, "changeEncounter", "Change Encounter", "systemSettings", [
		choice("value", DISABLE_ENABLE),
	]),
	command(137, "changeFormationAccess", "Change Formation Access", "systemSettings", [
		choice("value", DISABLE_ENABLE),
	]),
	command(138, "changeWindowColor", "Change Window Color", "systemSettings", [
		param("tone", "tone"),
	]),
	command(322, "changeActorImages", "Change Actor Images", "systemSettings", [
		param("actorId", "actorId"),
		param("characterName", "string"),
		param("characterIndex", "int"),
		param("faceName", "string"),
		param("faceIndex", "int"),
		param("battlerName", "string"),
	]),
	command(323, "changeVehicleImage", "Change Vehicle Image", "systemSettings", [
		choice("vehicle", VEHICLE),
		param("characterName", "string"),
		param("characterIndex", "int"),
	]),

	// Map
	command(281, "changeMapNameDisplay", "Change Map Name Display", "map", [choice("value", ON_OFF)]),
	command(282, "changeTileset", "Change Tileset", "map", [param("tilesetId", "tilesetId")]),
	command(283, "changeBattleBack", "Change Battle Background", "map", [
		param("battleback1Name", "string"),
		param("battleback2Name", "string"),
	]),
	command(284, "changeParallax", "Change Parallax", "map", [
		param("name", "string"),
		param("loopX", "bool"),
		param("loopY", "bool"),
		param("scrollX", "int"),
		param("scrollY", "int"),
	]),
	command(285, "getLocationInfo", "Get Location Info", "map", [
		param("variableId", "variableId", "Variable that receives the value"),
		choice("infoType", {
			0: "terrainTag",
			1: "eventId",
			2: "tileIdLayer1",
			3: "tileIdLayer2",
			4: "tileIdLayer3",
			5: "tileIdLayer4",
			6: "regionId",
		}),
		choice("designation", DIRECT_VARIABLES),
		param("x", "int", "X, or a variable ID holding it when designation is variables"),
		param("y", "int", "Y, or a variable ID holding it when designation is variables"),
	]),

	// Battle
	command(331, "changeEnemyHp", "Change Enemy HP", "battle", [
		enemyTarget,
		...operateValue,
		param("allowKnockout", "bool"),
	]),
	command(332, "changeEnemyMp", "Change Enemy MP", "battle", [enemyTarget, ...operateValue]),
	command(342, "changeEnemyTp", "Change Enemy TP", "battle", [enemyTarget, ...operateValue]),
	command(333, "changeEnemyState", "Change Enemy State", "battle", [
		enemyTarget,
		choice("operation", ADD_REMOVE),
		param("stateId", "stateId"),
	]),
	command(334, "enemyRecoverAll", "Enemy Recover All", "battle", [enemyTarget]),
	command(335, "enemyAppear", "Enemy Appear", "battle", [enemyTarget]),
	command(336, "enemyTransform", "Enemy Transform", "battle", [
		enemyTarget,
		param("enemyId", "enemyId"),
	]),
	command(337, "showBattleAnimation", "Show Battle Animation", "battle", [
		enemyTarget,
		param("animationId", "animationId"),
		param("entireTroop", "bool"),
	]),
	command(339, "forceAction", "Force Action", "battle", [
		choice("subjectType", { 0: "enemy", 1: "actor" }),
		param("subject", "int", "Enemy index or actor ID, by subjectType"),
		param("skillId", "skillId"),
		param("targetIndex", "int", "-2 last target, -1 random, otherwise the target's index"),
	]),
	command(340, "abortBattle", "Abort Battle", "battle"),

	// Advanced
	command(355, "script", "Script", "advanced", [
		param("script", "script", "First line of the script"),
	]),
	command(
		655,
		"scriptLine",
		"Script",
		"advanced",
		[param("script", "script")],
		continuationOf(355),
	),
	command(356, "pluginCommand", "Plugin Command", "advanced", [
		param("command", "string", "The command and its arguments, separated by spaces"),
	]),
];

const MOVE_COMMANDS: readonly MoveCommandInfo[] = [
	[0, "end", "End of Route"],
	[1, "moveDown", "Move Down"],
	[2, "moveLeft", "Move Left"],
	[3, "moveRight", "Move Right"],
	[4, "moveUp", "Move Up"],
	[5, "moveLowerLeft", "Move Lower Left"],
	[6, "moveLowerRight", "Move Lower Right"],
	[7, "moveUpperLeft", "Move Upper Left"],
	[8, "moveUpperRight", "Move Upper Right"],
	[9, "moveAtRandom", "Move at Random"],
	[10, "moveTowardPlayer", "Move toward Player"],
	[11, "moveAwayFromPlayer", "Move away from Player"],
	[12, "oneStepForward", "1 Step Forward"],
	[13, "oneStepBackward", "1 Step Backward"],
	[14, "jump", "Jump", [param("x", "int", "Relative X"), param("y", "int", "Relative Y")]],
	[15, "wait", "Wait", [param("frames", "int")]],
	[16, "turnDown", "Turn Down"],
	[17, "turnLeft", "Turn Left"],
	[18, "turnRight", "Turn Right"],
	[19, "turnUp", "Turn Up"],
	[20, "turn90Right", "Turn 90° Right"],
	[21, "turn90Left", "Turn 90° Left"],
	[22, "turn180", "Turn 180°"],
	[23, "turn90RightOrLeft", "Turn 90° Right or Left"],
	[24, "turnAtRandom", "Turn at Random"],
	[25, "turnTowardPlayer", "Turn toward Player"],
	[26, "turnAwayFromPlayer", "Turn away from Player"],
	[27, "switchOn", "Switch ON", [param("switchId", "switchId")]],
	[28, "switchOff", "Switch OFF", [param("switchId", "switchId")]],
	[29, "changeSpeed", "Change Speed", [param("speed", "int", "1 (slowest) to 6 (fastest)")]],
	[
		30,
		"changeFrequency",
		"Change Frequency",
		[param("frequency", "int", "1 (lowest) to 5 (highest)")],
	],
	[31, "walkingAnimationOn", "Walking Animation ON"],
	[32, "walkingAnimationOff", "Walking Animation OFF"],
	[33, "steppingAnimationOn", "Stepping Animation ON"],
	[34, "steppingAnimationOff", "Stepping Animation OFF"],
	[35, "directionFixOn", "Direction Fix ON"],
	[36, "directionFixOff", "Direction Fix OFF"],
	[37, "throughOn", "Through ON"],
	[38, "throughOff", "Through OFF"],
	[39, "transparentOn", "Transparent ON"],
	[40, "transparentOff", "Transparent OFF"],
	[
		41,
		"changeImage",
		"Change Image",
		[param("characterName", "string"), param("characterIndex", "int")],
	],
	[42, "changeOpacity", "Change Opacity", [param("opacity", "int", "0-255")]],
	[43, "changeBlendMode", "Change Blend Mode", [choice("blendMode", BLEND_MODE)]],
	[44, "playSe", "Play SE", [param("audio", "audio")]],
	[45, "script", "Script", [param("script", "script")]],
].map(
	([code, name, label, parameters = []]) => ({ code, name, label, parameters }) as MoveCommandInfo,
);

const BY_CODE = new Map(COMMANDS.map((info) => [info.code, info]));
const MOVE_BY_CODE = new Map(MOVE_COMMANDS.map((info) => [info.code, info]));

/** Every event command in the catalog, in editor order. */
export const EVENT_COMMANDS: readonly CommandInfo[] = COMMANDS;

/** Every move route command in the catalog, by code. */
export const MOVE_ROUTE_COMMANDS: readonly MoveCommandInfo[] = MOVE_COMMANDS;

/** Catalog entry for an event command code, or `undefined` for a code MV doesn't define. */
export function getCommandInfo(code: number): CommandInfo | undefined {
	return BY_CODE.get(code);
}

/** Catalog entry for a move route command code, or `undefined` for a code MV doesn't define. */
export function getMoveCommandInfo(code: number): MoveCommandInfo | undefined {
	return MOVE_BY_CODE.get(code);
}

/**
 * The catalog name of an event command code, or `unknown<code>` for codes MV doesn't define,
 * such as ones added by plugins or newer engines. Never throws.
 */
export function commandName(code: number): string {
	return BY_CODE.get(code)?.name ?? `unknown${code}`;
}

/**
 * Whether `code` is an extra line of the command before it (text, scrolling text, comment,
 * script, shop item and move route step lines).
 */
export function isContinuation(code: number): boolean {
	return BY_CODE.get(code)?.role.kind === "continuation";
}
