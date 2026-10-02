import { describe, expect, it } from "vitest";
import {
	buildStructure,
	createNames,
	createSymbols,
	decompileDocument,
	loadProject,
	RENDERERS,
	sumCoverage,
	walkStructure,
	type DecompileContext,
	type DecompiledScript,
	type EventCommand,
	type ListLocation,
	type RenderContext,
	type ScriptContainer,
} from "../src/index.js";
import { BATTLE_RENDERERS } from "../src/battle-renderers.js";
import { expectPrettierStable } from "./support/prettier.js";
import { describeWithGame } from "./support/test-game.js";

const named = (...names: string[]) => [null, ...names.map((name) => ({ name }))];

const context: DecompileContext = {
	symbols: createSymbols(
		createNames(
			{
				switches: ["", "Door_open"],
				variables: ["", "Damage", "Next troop", "Tile", "X", "Y"],
				equipTypes: ["", "Weapon", "Shield"],
			},
			{
				actor: named("Mira", "Tobin"),
				class: named("Knight"),
				skill: named("Bite"),
				item: named("Potion"),
				weapon: named("Club"),
				armor: named("Cloak"),
				enemy: named("Bat"),
				troop: named("Cave bats"),
				state: named("Poison"),
				animation: named("Slash"),
				tileset: named("Dungeon"),
			},
		),
	),
};

const cmd = (code: number, indent: number, parameters: unknown[] = []): EventCommand => ({
	code,
	indent,
	parameters,
});
const END = cmd(0, 0);
const audio = (name: string, volume = 90, pitch = 100, pan = 0) => ({ name, volume, pitch, pan });

function decompileList(list: EventCommand[]): DecompiledScript {
	const container: ScriptContainer = {
		kind: "commonEvent",
		id: 1,
		commonEvent: { id: 1, name: "Test", trigger: 0, switchId: 1, list: [...list, END] },
	};
	return decompileDocument([container], context);
}

/** The body of the printed common event, without its indentation. */
function body(script: DecompiledScript): string {
	return script.text
		.split("\n")
		.slice(3, -2)
		.map((line) => line.slice(1))
		.join("\n");
}

/** Expects each command to print as the given line, with no raw fallback. */
async function expectLines(cases: readonly [EventCommand, string][]): Promise<void> {
	const script = decompileList(cases.map(([command]) => command));
	expect(body(script)).toBe(cases.map(([, line]) => line).join("\n"));
	expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({});
	await expectPrettierStable(script);
}

/** Expects every command to use the raw fallback. */
function expectRaw(list: EventCommand[]): void {
	const script = decompileList(list);
	const raw = [...script.coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
	expect(raw).toBe(list.length);
}

describe("battle processing", () => {
	it("prints battles without branches", async () => {
		await expectLines([
			[cmd(301, 0, [0, 1, false, false]), 'battle(troops["Cave bats"]);'],
			[cmd(301, 0, [1, 2, false, false]), 'battle(troops[variables["Next troop"]]);'],
			[cmd(301, 0, [2, 0, false, false]), 'battle("randomEncounter");'],
			[cmd(301, 0, [0, 7, false, false]), "battle(troops[7]);"],
		]);
	});

	it("prints result branches as handlers", async () => {
		const script = decompileList([
			cmd(301, 0, [0, 1, true, true]),
			cmd(601, 0),
			cmd(121, 1, [1, 1, 0]),
			cmd(0, 1),
			cmd(602, 0),
			cmd(0, 1),
			cmd(603, 0),
			cmd(353, 1),
			cmd(0, 1),
			cmd(604, 0),
			cmd(301, 0, [1, 2, true, false]),
			cmd(601, 0),
			cmd(0, 1),
			cmd(602, 0),
			cmd(0, 1),
			cmd(604, 0),
			cmd(301, 0, [0, 1, false, false]),
			cmd(601, 0),
			cmd(0, 1),
			cmd(604, 0),
		]);
		expect(body(script)).toBe(
			[
				'battle(troops["Cave bats"], {',
				"\tonWin: () => {",
				"\t\tswitches.Door_open = true;",
				"\t},",
				"\tonEscape: () => {},",
				"\tonLose: () => {",
				"\t\tgameOver();",
				"\t},",
				"});",
				'battle(troops[variables["Next troop"]], { onWin: () => {}, onEscape: () => {} });',
				'battle(troops["Cave bats"], { onWin: () => {} });',
			].join("\n"),
		);
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({});
		await expectPrettierStable(script);
	});

	it("maps the lines of a battle to its commands", () => {
		const script = decompileList([
			cmd(301, 0, [0, 1, true, false]),
			cmd(601, 0),
			cmd(353, 1),
			cmd(0, 1),
			cmd(602, 0),
			cmd(353, 1),
			cmd(0, 1),
			cmd(604, 0),
		]);
		const location: ListLocation = { kind: "commonEvent", commonEventId: 1 };
		const lineOf = (index: number) => script.sourceMap.linesOf(location, index);
		// Line 3 is `battle(…, {`, 4 `onWin`, 5 its body, 6 its `},`, 7 to 9 `onEscape`, 10 `});`.
		expect(lineOf(0)).toEqual({ startLine: 3, endLine: 10 });
		expect(lineOf(1)).toEqual({ startLine: 4, endLine: 4 });
		expect(lineOf(2)).toEqual({ startLine: 5, endLine: 5 });
		expect(lineOf(3)).toEqual({ startLine: 6, endLine: 6 });
		expect(lineOf(4)).toEqual({ startLine: 7, endLine: 7 });
		expect(lineOf(6)).toEqual({ startLine: 9, endLine: 9 });
		expect(lineOf(7)).toEqual({ startLine: 10, endLine: 10 });
	});

	it("keeps battles whose flags don't match their branches raw", () => {
		const script = decompileList([
			// Can Escape without an If Escape branch.
			cmd(301, 0, [0, 1, true, false]),
			// No branches, but flags set.
			cmd(301, 0, [0, 1, false, true]),
			cmd(301, 0, [0, 1, false, false]),
			cmd(601, 0),
			cmd(0, 1),
			cmd(602, 0),
			cmd(0, 1),
			cmd(604, 0),
			cmd(301, 0, [0, 1, 1, 0]),
			cmd(301, 0, [2, 5, false, false]),
			cmd(301, 0, [3, 1, false, false]),
			cmd(301, 0, [0, 1, false]),
			cmd(301, 0, [0, 1, true, true]),
			cmd(601, 0),
			cmd(0, 1),
			cmd(603, 0),
			cmd(0, 1),
			cmd(602, 0),
			cmd(0, 1),
			cmd(604, 0),
		]);
		expect(script.coverage.rawByCode.get(301)).toBe(8);
		expect(script.text).not.toContain("battle(");
	});
});

describe("shop processing", () => {
	it("prints goods as a builder", async () => {
		const script = decompileList([
			cmd(302, 0, [0, 1, 0, 0, false]),
			cmd(302, 0, [1, 1, 1, 50, true]),
			cmd(605, 0, [2, 1, 0, 0]),
			cmd(302, 0, [0, 1, 0, 0, true]),
			cmd(605, 0, [1, 1, 1, 120]),
			cmd(605, 0, [2, 1, 0, 0]),
			cmd(605, 0, [0, 1, 1, 5]),
			cmd(605, 0, [0, 9, 0, 0]),
		]);
		expect(body(script)).toBe(
			[
				"shop().goods(items.Potion);",
				"shop({ purchaseOnly: true }).goods(weapons.Club, { price: 50 }).goods(armors.Cloak);",
				"shop({ purchaseOnly: true })",
				"\t.goods(items.Potion)",
				"\t.goods(weapons.Club, { price: 120 })",
				"\t.goods(armors.Cloak)",
				"\t.goods(items.Potion, { price: 5 })",
				"\t.goods(items[9]);",
			].join("\n"),
		);
		expect(Object.fromEntries(script.coverage.rawByCode)).toEqual({});
		await expectPrettierStable(script);
	});

	it("keeps goods it can't print exactly raw", () => {
		expectRaw([
			cmd(302, 0, [3, 1, 0, 0, false]),
			cmd(302, 0, [0, 1, 0, 10, false]),
			cmd(302, 0, [0, 1, 0, 0, 0]),
			cmd(302, 0, [0, 1, 0, 0]),
			cmd(302, 0, [0, 1, 0, 0, false]),
			cmd(605, 0, [0, 1, 2, 0]),
		]);
	});
});

describe("party commands", () => {
	it("prints gold, items and party members", async () => {
		await expectLines([
			[cmd(125, 0, [0, 0, 100]), "changeGold(+100);"],
			[cmd(125, 0, [1, 1, 1]), "changeGold(-variables.Damage);"],
			[cmd(126, 0, [1, 0, 0, 1]), "changeItems(items.Potion, +1);"],
			[cmd(126, 0, [1, 1, 0, 0]), "changeItems(items.Potion, -0);"],
			[
				cmd(127, 0, [1, 1, 0, 2, true]),
				"changeWeapons(weapons.Club, -2, { includeEquipment: true });",
			],
			[cmd(128, 0, [1, 0, 1, 3, false]), "changeArmors(armors.Cloak, +variables.Tile);"],
			[cmd(129, 0, [1, 0, true]), 'changePartyMember(actors.Mira, "add", { initialize: true });'],
			[cmd(129, 0, [2, 1, false]), 'changePartyMember(actors.Tobin, "remove");'],
		]);
	});

	it("keeps amounts it can't print exactly raw", () => {
		expectRaw([
			cmd(125, 0, [0, 0, -5]),
			cmd(125, 0, [2, 0, 5]),
			cmd(125, 0, [0, 2, 5]),
			cmd(125, 0, [0, 0, 5, 0]),
			cmd(126, 0, [1, 0, 0, Number.POSITIVE_INFINITY]),
			cmd(126, 0, [1, 0, 0, "1"]),
			cmd(127, 0, [1, 0, 0, 1, 0]),
			cmd(129, 0, [1, 2, false]),
		]);
	});
});

describe("actor commands", () => {
	it("prints every actor command", async () => {
		await expectLines([
			[cmd(311, 0, [0, 0, 1, 0, 10, true]), "changeHp(party, -10, { allowKnockout: true });"],
			[
				cmd(311, 0, [1, 1, 0, 1, 1, false]),
				"changeHp(actors[variables.Damage], +variables.Damage);",
			],
			[cmd(312, 0, [0, 1, 0, 0, 5]), "changeMp(actors.Mira, +5);"],
			[cmd(326, 0, [0, 2, 1, 0, 5]), "changeTp(actors.Tobin, -5);"],
			[cmd(313, 0, [0, 1, 0, 1]), 'changeState(actors.Mira, "add", states.Poison);'],
			[cmd(313, 0, [1, 3, 1, 1]), 'changeState(actors[variables.Tile], "remove", states.Poison);'],
			[cmd(314, 0, [0, 0]), "recoverAll(party);"],
			[
				cmd(315, 0, [0, 1, 0, 0, 100, true]),
				"changeExp(actors.Mira, +100, { showLevelUp: true });",
			],
			[cmd(316, 0, [0, 1, 1, 0, 1, false]), "changeLevel(actors.Mira, -1);"],
			[cmd(317, 0, [0, 1, 7, 0, 0, 2]), 'changeParameter(actors.Mira, "luck", +2);'],
			[cmd(318, 0, [0, 1, 0, 1]), 'changeSkill(actors.Mira, "learn", skills.Bite);'],
			[cmd(318, 0, [0, 0, 1, 1]), 'changeSkill(party, "forget", skills.Bite);'],
			[cmd(319, 0, [1, 1, 1]), "changeEquipment(actors.Mira, equipTypes.Weapon, weapons.Club);"],
			[cmd(319, 0, [1, 2, 1]), "changeEquipment(actors.Mira, equipTypes.Shield, armors.Cloak);"],
			[cmd(319, 0, [1, 1, 0]), "changeEquipment(actors.Mira, equipTypes.Weapon, null);"],
			[cmd(320, 0, [1, "Mira"]), 'changeName(actors.Mira, "Mira");'],
			[cmd(321, 0, [1, 1, true]), "changeClass(actors.Mira, classes.Knight, { keepExp: true });"],
			[cmd(324, 0, [1, ""]), 'changeNickname(actors.Mira, "");'],
			[cmd(325, 0, [1, 'The "old" knight']), "changeProfile(actors.Mira, 'The \"old\" knight');"],
		]);
	});

	it("breaks long argument lists as Prettier does", async () => {
		const script = decompileList([
			cmd(322, 0, [1, "Actor_character_sheet", 3, "Actor_face_sheet", 7, "Actor_battler_1"]),
			cmd(311, 0, [1, 2, 1, 1, 3, true]),
		]);
		expect(body(script)).toBe(
			[
				"changeActorImages(",
				"\tactors.Mira,",
				'\t"Actor_character_sheet",',
				"\t3,",
				'\t"Actor_face_sheet",',
				"\t7,",
				'\t"Actor_battler_1",',
				");",
				'changeHp(actors[variables["Next troop"]], -variables.Tile, { allowKnockout: true });',
			].join("\n"),
		);
		await expectPrettierStable(script);
	});

	it("keeps actor commands it can't print exactly raw", () => {
		expectRaw([
			cmd(311, 0, [2, 1, 0, 0, 1, false]),
			cmd(311, 0, [0, -1, 0, 0, 1, false]),
			cmd(311, 0, [0, 1, 0, 0, 1]),
			cmd(313, 0, [0, 1, 2, 1]),
			cmd(317, 0, [0, 1, 8, 0, 0, 1]),
			cmd(318, 0, [0, 1, 2, 1]),
			cmd(320, 0, [1, "two\nlines"]),
			cmd(325, 0, [1, 5]),
			cmd(321, 0, [1, 1, 1]),
		]);
	});
});

describe("enemy commands", () => {
	it("prints every enemy command", async () => {
		await expectLines([
			[cmd(331, 0, [0, 1, 0, 50, false]), "changeEnemyHp(troop.members[0], -50);"],
			[
				cmd(331, 0, [-1, 0, 1, 1, true]),
				"changeEnemyHp(troop, +variables.Damage, { allowKnockout: true });",
			],
			[cmd(332, 0, [2, 1, 0, 10]), "changeEnemyMp(troop.members[2], -10);"],
			[cmd(342, 0, [-1, 0, 0, 10]), "changeEnemyTp(troop, +10);"],
			[cmd(333, 0, [-1, 0, 1]), 'changeEnemyState(troop, "add", states.Poison);'],
			[cmd(333, 0, [1, 1, 1]), 'changeEnemyState(troop.members[1], "remove", states.Poison);'],
			[cmd(334, 0, [-1]), "enemyRecoverAll(troop);"],
			[cmd(335, 0, [3]), "enemyAppear(troop.members[3]);"],
			[cmd(336, 0, [0, 1]), "enemyTransform(troop.members[0], enemies.Bat);"],
			[cmd(337, 0, [0, 1, true]), "showBattleAnimation(troop, animations.Slash);"],
			[cmd(337, 0, [4, 1, false]), "showBattleAnimation(troop.members[4], animations.Slash);"],
			[cmd(339, 0, [0, 1, 1, -1]), 'forceAction(troop.members[1], skills.Bite, "random");'],
			[cmd(339, 0, [1, 2, 1, -2]), 'forceAction(actors.Tobin, skills.Bite, "lastTarget");'],
			[cmd(339, 0, [0, 0, 1, 2]), "forceAction(troop.members[0], skills.Bite, 2);"],
			[cmd(340, 0), "abortBattle();"],
		]);
	});

	it("keeps enemy commands it can't print exactly raw", () => {
		expectRaw([
			cmd(331, 0, [-2, 0, 0, 1, false]),
			cmd(335, 0, [1.5]),
			cmd(337, 0, [2, 1, true]),
			cmd(337, 0, [-1, 1, false]),
			cmd(339, 0, [2, 1, 1, -1]),
			cmd(339, 0, [0, 1, 1, -3]),
			cmd(340, 0, [0]),
		]);
	});
});

describe("system settings, map and scene commands", () => {
	it("prints every command", async () => {
		await expectLines([
			[cmd(132, 0, [audio("Battle2")]), 'changeBattleBgm("Battle2");'],
			[
				cmd(133, 0, [audio("Victory1", 80, 110, -20)]),
				'changeVictoryMe("Victory1", { volume: 80, pitch: 110, pan: -20 });',
			],
			[cmd(139, 0, [audio("")]), 'changeDefeatMe("");'],
			[
				cmd(140, 0, [2, audio("Ship", 100)]),
				'changeVehicleBgm("airship", "Ship", { volume: 100 });',
			],
			[cmd(134, 0, [0]), "changeSaveAccess(false);"],
			[cmd(135, 0, [1]), "changeMenuAccess(true);"],
			[cmd(136, 0, [0]), "changeEncounter(false);"],
			[cmd(137, 0, [1]), "changeFormationAccess(true);"],
			[cmd(138, 0, [[-34, 0, 68, 0]]), "changeWindowColor([-34, 0, 68, 0]);"],
			[
				cmd(322, 0, [2, "Actor1", 0, "", 0, "Tobin"]),
				'changeActorImages(actors.Tobin, "Actor1", 0, "", 0, "Tobin");',
			],
			[cmd(323, 0, [0, "Vehicle", 3]), 'changeVehicleImage("boat", "Vehicle", 3);'],
			[cmd(281, 0, [0]), "changeMapNameDisplay(true);"],
			[cmd(282, 0, [1]), "changeTileset(tilesets.Dungeon);"],
			[cmd(283, 0, ["", "Cave"]), 'changeBattleBack("", "Cave");'],
			[cmd(284, 0, ["Sky", false, false, 0, 0]), 'changeParallax("Sky");'],
			[
				cmd(284, 0, ["Sky", true, true, -2, 1]),
				'changeParallax("Sky", { loopX: true, loopY: true, scrollX: -2, scrollY: 1 });',
			],
			[cmd(285, 0, [3, 6, 0, 5, 6]), 'getLocationInfo(variables.Tile, "regionId", 5, 6);'],
			[
				cmd(285, 0, [3, 0, 1, 4, 5]),
				'getLocationInfo(variables.Tile, "terrainTag", variables.X, variables.Y);',
			],
			[cmd(303, 0, [1, 8]), "nameInputProcessing(actors.Mira, 8);"],
			[cmd(351, 0), "openMenuScreen();"],
			[cmd(352, 0), "openSaveScreen();"],
			[cmd(353, 0), "gameOver();"],
			[cmd(354, 0), "returnToTitleScreen();"],
		]);
	});

	it("keeps commands it can't print exactly raw", () => {
		expectRaw([
			cmd(132, 0, [{ name: "Battle2", volume: 90, pitch: 100 }]),
			cmd(132, 0, [{ volume: 90, name: "Battle2", pitch: 100, pan: 0 }]),
			cmd(132, 0, [{ name: "Battle2", volume: "90", pitch: 100, pan: 0 }]),
			cmd(140, 0, [3, audio("Ship")]),
			cmd(134, 0, [true]),
			cmd(138, 0, [[0, 0, 0]]),
			cmd(281, 0, [2]),
			cmd(284, 0, ["Sky", 1, false, 0, 0]),
			cmd(285, 0, [3, 7, 0, 5, 6]),
			cmd(285, 0, [3, 0, 2, 0, 0]),
			cmd(351, 0, [1]),
		]);
	});
});

describe("renderer registry", () => {
	it("registers a renderer for every code of #44", () => {
		const codes = BATTLE_RENDERERS.map(([code]) => code);
		expect(new Set(codes).size).toBe(codes.length);
		for (const code of codes) {
			expect(RENDERERS.get(code)).toBeDefined();
		}
	});
});

describeWithGame("battle renderers on the configured test game", (game) => {
	it(
		"prints every battle and remaining command the game contains",
		{ timeout: 120_000 },
		async () => {
			const project = await loadProject(game);
			const renderers = new Map(BATTLE_RENDERERS);
			// Every node of these codes, wherever it is: also inside blocks that other groups still
			// print raw, so the count doesn't depend on them.
			const seen = new Map<number, number>();
			const declined = new Map<number, number>();
			for await (const { list } of project.commandLists()) {
				const renderContext: RenderContext = {
					list,
					symbols: project.symbols,
					depth: 0,
					inLoop: false,
					body: () => [],
					nested: () => undefined,
					segment: (_start, _end, doc) => doc,
					useEvent: () => undefined,
					character: () => undefined,
				};
				for (const node of walkStructure(buildStructure(list))) {
					const renderer =
						node.kind === "block" || node.kind === "command" ? renderers.get(node.code) : undefined;
					if (!renderer || node.kind === "end" || node.kind === "raw") {
						continue;
					}
					seen.set(node.code, (seen.get(node.code) ?? 0) + 1);
					if (renderer(node, renderContext) === undefined) {
						declined.set(node.code, (declined.get(node.code) ?? 0) + 1);
					}
				}
			}
			// The raw-fallback share of the whole game, with every group's renderers.
			const containers = [
				...project.commonEvents.flatMap((commonEvent, id): ScriptContainer[] =>
					commonEvent ? [{ kind: "commonEvent", id, commonEvent }] : [],
				),
				...project.troops.flatMap((troop, id): ScriptContainer[] =>
					troop ? [{ kind: "troop", id, troop }] : [],
				),
			];
			const coverages = [decompileDocument(containers, { symbols: project.symbols }).coverage];
			for (const mapId of project.mapIds()) {
				const map = await project.map(mapId);
				const events = map.events.flatMap((event, id): ScriptContainer[] =>
					event ? [{ kind: "mapEvent", mapId, id, event }] : [],
				);
				coverages.push(decompileDocument(events, { symbols: project.symbols }).coverage);
			}
			const coverage = sumCoverage(coverages);
			const raw = [...coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
			console.log(
				`battle renderers: nodes by code ${JSON.stringify(Object.fromEntries(seen))}; declined: ` +
					`${JSON.stringify(Object.fromEntries(declined))}; raw fallback now ${raw} of ` +
					`${coverage.commands} commands (${((100 * raw) / coverage.commands).toFixed(1)}%)`,
			);
			expect(Object.fromEntries(declined)).toEqual({});
			// Battle Processing layouts: 288 without branches, 1,180 with win and escape, 316 with all three.
			expect(seen.get(301)).toBe(1784);
		},
	);
});
