import { describe, expect, it } from "vitest";
import {
	MOVE_ROUTE_COMMANDS,
	createNames,
	createSymbols,
	decompileDocument,
	loadProject,
	RENDERERS,
	sumCoverage,
	type CommandRenderer,
	type DecompileContext,
	type DecompiledScript,
	type EventCommand,
	type EventPage,
	type MapEvent,
	type ScriptContainer,
} from "../src/index.js";
import { expectPrettierStable } from "./support/prettier.js";
import { describeWithGame } from "./support/test-game.js";

const named = (...names: string[]) => [null, ...names.map((name) => ({ name }))];

const context: DecompileContext = {
	symbols: createSymbols(
		createNames(
			{
				switches: ["", "Door_open", "Lantern lit"],
				variables: ["", "To_map", "To_x", "To_y"],
			},
			{
				map: named("Forest", "Harbor town"),
				animation: named("Slash"),
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

const audio = (name: string, volume = 90, pitch = 100, pan = 0) => ({ name, volume, pitch, pan });

/** Prints each command (or 205 with its 505 lines) and checks the statement it prints as. */
async function expectPrinted(
	cases: readonly (readonly [EventCommand | EventCommand[], string])[],
): Promise<void> {
	const script = decompileList(cases.flatMap(([commands]) => commands));
	expect(body(script)).toBe(cases.map(([, text]) => text).join("\n"));
	expect(script.coverage.rawByCode.size).toBe(0);
	await expectPrettierStable(script);
}

/** Checks that each command is kept as a raw command. */
function expectRaw(commands: readonly EventCommand[]): void {
	const script = decompileList([...commands]);
	const raw = [...script.coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
	expect(raw).toBe(commands.length);
	expect(
		body(script)
			.split("\n")
			.every((line) => line.startsWith("command(")),
	).toBe(true);
}

describe("movement commands", () => {
	it("prints transfers, locations, scrolling and vehicles", async () => {
		await expectPrinted([
			[cmd(201, 0, [0, 1, 10, 5, 0, 0]), "transferPlayer(maps.Forest, 10, 5);"],
			[
				cmd(201, 0, [0, 2, 3, 4, 8, 1]),
				'transferPlayer(maps["Harbor town"], 3, 4, { direction: "up", fade: "white" });',
			],
			[
				cmd(201, 0, [0, 9, 0, 0, 2, 2]),
				'transferPlayer(maps[9], 0, 0, { direction: "down", fade: "none" });',
			],
			[
				cmd(201, 0, [1, 1, 2, 3, 0, 0]),
				"transferPlayer(maps[variables.To_map], variables.To_x, variables.To_y);",
			],
			[cmd(202, 0, [0, 0, 2, 4, 9]), 'setVehicleLocation("boat", maps["Harbor town"], 4, 9);'],
			[
				cmd(202, 0, [2, 1, 1, 2, 3]),
				'setVehicleLocation("airship", maps[variables.To_map], variables.To_x, variables.To_y);',
			],
			[cmd(203, 0, [0, 0, 3, 4, 0]), "setEventLocation(event, 3, 4);"],
			[
				cmd(203, 0, [5, 0, 3, 4, 2]),
				'setEventLocation(map.events[5], 3, 4, { direction: "down" });',
			],
			[
				cmd(203, 0, [5, 1, 2, 3, 0]),
				"setEventLocation(map.events[5], variables.To_x, variables.To_y);",
			],
			[cmd(203, 0, [5, 2, 0, 0, 0]), "setEventLocation(map.events[5], { swapWith: event });"],
			[
				cmd(203, 0, [0, 2, 6, 0, 4]),
				'setEventLocation(event, { swapWith: map.events[6], direction: "left" });',
			],
			[cmd(204, 0, [8, 5, 4]), 'scrollMap("up", 5);'],
			[cmd(204, 0, [2, 3, 6]), 'scrollMap("down", 3, { speed: 6 });'],
			[cmd(206, 0), "getOnOffVehicle();"],
		]);
	});

	it("keeps movement commands it can't print exactly as raw commands", () => {
		expectRaw([
			cmd(201, 0, [0, 1, 10, 5, 0]),
			cmd(201, 0, [2, 1, 10, 5, 0, 0]),
			cmd(201, 0, [1, 1, 2.5, 3, 0, 0]),
			cmd(201, 0, [0, 1, 10, 5, "up", 0]),
			cmd(203, 0, [-2, 0, 3, 4, 0]),
			cmd(203, 0, [5, 2, 0, 1, 0]),
			cmd(203, 0, [5, 3, 0, 0, 0]),
			cmd(204, 0, [8, 5]),
			cmd(206, 0, [0]),
		]);
	});
});

describe("character commands", () => {
	it("prints transparency, animations, balloons and followers", async () => {
		await expectPrinted([
			[cmd(211, 0, [0]), "changeTransparency(true);"],
			[cmd(211, 0, [1]), "changeTransparency(false);"],
			[cmd(212, 0, [-1, 1, false]), "showAnimation(player, animations.Slash);"],
			[cmd(212, 0, [3, 7, true]), "showAnimation(map.events[3], animations[7], { wait: true });"],
			[cmd(213, 0, [0, 1, false]), 'showBalloonIcon(event, "exclamation");'],
			[cmd(213, 0, [-1, 10, true]), 'showBalloonIcon(player, "zzz", { wait: true });'],
			[cmd(213, 0, [-1, 12, false]), "showBalloonIcon(player, 12);"],
			[cmd(214, 0), "eraseEvent();"],
			[cmd(216, 0, [0]), "changePlayerFollowers(true);"],
			[cmd(216, 0, [1]), "changePlayerFollowers(false);"],
			[cmd(217, 0), "gatherFollowers();"],
		]);
	});

	it("keeps character commands it can't print exactly as raw commands", () => {
		expectRaw([
			cmd(211, 0, [2]),
			cmd(211, 0, [true]),
			cmd(212, 0, [-1, 1, 0]),
			cmd(212, 0, [-3, 1, false]),
			cmd(213, 0, [-1, "1", false]),
			cmd(214, 0, [1]),
		]);
	});
});

describe("timing, screen, audio and video commands", () => {
	it("prints waits and screen effects", async () => {
		await expectPrinted([
			[cmd(230, 0, [60]), "wait(60);"],
			[cmd(221, 0), "fadeoutScreen();"],
			[cmd(222, 0), "fadeinScreen();"],
			[cmd(223, 0, [[-68, -68, 0, 68], 60, true]), "tintScreen([-68, -68, 0, 68], 60);"],
			[cmd(223, 0, [[0, 0, 0, 0], 40, false]), "tintScreen([0, 0, 0, 0], 40, { wait: false });"],
			[
				cmd(224, 0, [[255, 255, 255, 170], 8, false]),
				"flashScreen([255, 255, 255, 170], 8, { wait: false });",
			],
			[cmd(225, 0, [5, 5, 30, true]), "shakeScreen(5, 5, 30);"],
			[cmd(225, 0, [1, 9, 70, false]), "shakeScreen(1, 9, 70, { wait: false });"],
			[cmd(236, 0, ["rain", 5, 60, true]), 'setWeatherEffect("rain", 5, 60);'],
			[cmd(236, 0, ["none", 0, 0, false]), 'setWeatherEffect("none", 0, 0, { wait: false });'],
		]);
	});

	it("prints audio and movies, leaving out default volume, pitch and pan", async () => {
		await expectPrinted([
			[cmd(241, 0, [audio("Town1")]), 'playBgm("Town1");'],
			[cmd(241, 0, [audio("", 90, 100, 0)]), 'playBgm("");'],
			[cmd(242, 0, [3]), "fadeoutBgm(3);"],
			[cmd(243, 0), "saveBgm();"],
			[cmd(244, 0), "replayBgm();"],
			[cmd(245, 0, [audio("Rain", 30)]), 'playBgs("Rain", { volume: 30 });'],
			[cmd(246, 0, [1]), "fadeoutBgs(1);"],
			[cmd(249, 0, [audio("Fanfare1", 90, 110)]), 'playMe("Fanfare1", { pitch: 110 });'],
			[
				cmd(250, 0, [audio("Door1", 80, 90, -20)]),
				'playSe("Door1", { volume: 80, pitch: 90, pan: -20 });',
			],
			[cmd(251, 0), "stopSe();"],
			[cmd(261, 0, ["Intro"]), 'playMovie("Intro");'],
		]);
	});

	it("keeps audio with other keys or key orders as raw commands", () => {
		expectRaw([
			cmd(250, 0, [{ name: "Door1", pan: 0, pitch: 100, volume: 90 }]),
			cmd(250, 0, [{ name: "Door1", volume: 90, pitch: 100 }]),
			cmd(250, 0, [{ ...audio("Door1"), extra: 1 }]),
			cmd(250, 0, [audio("Two\nlines")]),
			cmd(250, 0, [audio("Door1"), 1]),
			cmd(223, 0, [[0, 0, 0], 60, true]),
			cmd(223, 0, [[0, 0, 0, 0], 60, 1]),
			cmd(230, 0, ["60"]),
			cmd(230, 0, [-0]),
			cmd(261, 0, [1]),
		]);
	});
});

describe("picture commands", () => {
	it("prints pictures, with positions from variables and options at their defaults left out", async () => {
		await expectPrinted([
			[
				cmd(231, 0, [1, "Overlay", 0, 0, 0, 0, 100, 100, 255, 0]),
				'showPicture(1, "Overlay", 0, 0);',
			],
			[
				cmd(231, 0, [2, "Fog", 1, 1, 2, 3, 80, 50, 200, 3]),
				'showPicture(2, "Fog", variables.To_x, variables.To_y, {\n' +
					'\torigin: "center",\n' +
					"\tscaleX: 80,\n" +
					"\tscaleY: 50,\n" +
					"\topacity: 200,\n" +
					'\tblendMode: "screen",\n' +
					"});",
			],
			[
				cmd(232, 0, [1, 0, 0, 0, 408, 312, 100, 100, 255, 0, 60, true]),
				"movePicture(1, 408, 312, 60);",
			],
			[
				cmd(232, 0, [1, 0, 1, 0, -104, 1, 80, 80, 0, 1, 15, false]),
				"movePicture(1, -104, 1, 15, {\n" +
					'\torigin: "center",\n' +
					"\tscaleX: 80,\n" +
					"\tscaleY: 80,\n" +
					"\topacity: 0,\n" +
					'\tblendMode: "additive",\n' +
					"\twait: false,\n" +
					"});",
			],
			[cmd(233, 0, [1, -5]), "rotatePicture(1, -5);"],
			[cmd(234, 0, [1, [0, 0, 0, 255], 60, true]), "tintPicture(1, [0, 0, 0, 255], 60);"],
			[
				cmd(234, 0, [1, [0, 0, 0, 255], 5, false]),
				"tintPicture(1, [0, 0, 0, 255], 5, { wait: false });",
			],
			[cmd(235, 0, [1]), "erasePicture(1);"],
		]);
	});

	it("keeps pictures it can't print exactly as raw commands", () => {
		expectRaw([
			cmd(231, 0, [1, "Overlay", 0, 0, 0, 0, 100, 100, 255]),
			cmd(231, 0, [1, "Overlay", 0, 2, 0, 0, 100, 100, 255, 0]),
			cmd(231, 0, [1, "Overlay", "center", 0, 0, 0, 100, 100, 255, 0]),
			cmd(232, 0, [1, null, 0, 0, 408, 312, 100, 100, 255, 0, 60, true]),
			cmd(232, 0, [1, 0, 0, 0, 408, 312, 100, 100, 255, 0, 60]),
			cmd(234, 0, [1, [0, 0, 0, 255], 60]),
			cmd(235, 0, [-1]),
		]);
	});
});

/** A 205 with its route, followed by the 505 copies of its steps. */
function route(
	character: number,
	steps: readonly object[],
	options: { repeat?: boolean; skippable?: boolean; wait?: boolean } = {},
): EventCommand[] {
	const { repeat = false, skippable = false, wait = true } = options;
	return [
		cmd(205, 0, [character, { list: [...steps, { code: 0 }], repeat, skippable, wait }]),
		...steps.map((step) => cmd(505, 0, [step])),
	];
}

const step = (code: number, parameters?: unknown[], indent: 0 | null = null) =>
	parameters === undefined ? { code, indent } : { code, parameters, indent };

describe("move routes", () => {
	it("prints every step code as a method of the chain", async () => {
		const withParameters: Record<number, [unknown[], string]> = {
			14: [[2, -1], "jump(2, -1)"],
			15: [[15], "wait(15)"],
			27: [[1], "switchOn(switches.Door_open)"],
			28: [[2], 'switchOff(switches["Lantern lit"])'],
			29: [[4], "changeSpeed(4)"],
			30: [[3], "changeFrequency(3)"],
			41: [["Actor1", 2], 'changeImage("Actor1", 2)'],
			42: [[128], "changeOpacity(128)"],
			43: [[2], 'changeBlendMode("multiply")'],
			44: [[audio("Knock", 80)], 'playSe("Knock", { volume: 80 })'],
			45: [["this.setOpacity(128)"], "script(() => this.setOpacity(128))"],
		};
		const infos = MOVE_ROUTE_COMMANDS.filter((info) => info.code !== 0);
		expect(infos).toHaveLength(45);
		const steps = infos.map((info) => {
			const entry = withParameters[info.code];
			return entry ? step(info.code, entry[0]) : step(info.code);
		});
		const script = decompileList(route(-1, steps));
		const methods = infos.map((info) => withParameters[info.code]?.[1] ?? `${info.name}()`);
		expect(body(script)).toBe(
			["setMovementRoute(player)", ...methods.map((method) => `\t.${method}`)].join("\n") + ";",
		);
		expect(script.coverage.rawByCode.size).toBe(0);
		await expectPrettierStable(script);
	});

	it("prints options, step indents and short routes on one line", async () => {
		await expectPrinted([
			[route(-1, []), "setMovementRoute(player);"],
			[
				route(0, [step(1)], { skippable: true }),
				"setMovementRoute(event, { skippable: true }).moveDown();",
			],
			[
				route(3, [step(19), step(4, undefined, 0), step(15, [15], 0)], {
					repeat: true,
					wait: false,
				}),
				"setMovementRoute(map.events[3], { repeat: true, wait: false })\n" +
					"\t.turnUp()\n" +
					"\t.moveUp({ indent: 0 })\n" +
					"\t.wait(15, { indent: 0 });",
			],
			[
				route(-1, [step(44, [audio("Knock", 80)], 0), step(44, [audio("Knock")], 0)]),
				"setMovementRoute(player)\n" +
					'\t.playSe("Knock", { volume: 80, indent: 0 })\n' +
					'\t.playSe("Knock", { indent: 0 });',
			],
			[route(-1, [step(2), step(18)]), "setMovementRoute(player).moveLeft().turnRight();"],
		]);
	});

	it("follows Prettier's member-chain layout", async () => {
		// Scripts ending in `;` aren't one expression, so they stay strings.
		const long = "this.setOpacity(this.opacity() - 10); this.setBlendMode(1); this.jump(0, 0);";
		const script = decompileList([
			// One step: the chain stays together, and only the arguments break.
			...route(-1, [step(45, [long + long])], { repeat: true, skippable: true, wait: false }),
			// Two steps that fit on one line, and two that don't.
			...route(-1, [step(45, ["a;"]), step(45, ["b;"])]),
			...route(-1, [step(45, [long]), step(45, ["b;"])]),
			// A string split with `+` is not a simple argument, so the chain breaks.
			...route(-1, [step(45, ["`'\""]), step(1)]),
			// Nor is a lambda, but a chain with one step stays together.
			...route(-1, [step(45, ["a"])]),
			...route(-1, [step(45, ["a"]), step(1)]),
		]);
		expect(body(script)).toBe(
			[
				"setMovementRoute(player, { repeat: true, skippable: true, wait: false }).script(",
				`\t"${long + long}",`,
				");",
				'setMovementRoute(player).script("a;").script("b;");',
				"setMovementRoute(player)",
				`\t.script("${long}")`,
				'\t.script("b;");',
				"setMovementRoute(player)",
				"\t.script(\"`'\" + '\"')",
				"\t.moveDown();",
				"setMovementRoute(player).script(() => a);",
				"setMovementRoute(player)",
				"\t.script(() => a)",
				"\t.moveDown();",
			].join("\n"),
		);
		await expectPrettierStable(script);
	});

	it("keeps routes it can't print exactly as raw commands", () => {
		const moveUp = step(4);
		const raw = (commands: EventCommand[]) => {
			const script = decompileList(commands);
			expect(script.coverage.rawByCode.get(205)).toBe(1);
			expect(script.text).not.toContain("setMovementRoute");
		};
		// Route keys in another order, or another terminator.
		raw([cmd(205, 0, [-1, { repeat: false, list: [{ code: 0 }], skippable: false, wait: true }])]);
		raw([
			cmd(205, 0, [
				-1,
				{ list: [{ code: 0, parameters: [] }], repeat: false, skippable: false, wait: true },
			]),
		]);
		raw([cmd(205, 0, [-1, { list: [], repeat: false, skippable: false, wait: true }])]);
		raw([cmd(205, 0, [-1, { list: [{ code: 0 }], repeat: 0, skippable: false, wait: true }])]);
		// 505 copies that are missing, extra or different.
		raw(route(-1, [moveUp]).slice(0, 1));
		raw([...route(-1, [moveUp]), cmd(505, 0, [moveUp])]);
		raw([route(-1, [moveUp])[0] as EventCommand, cmd(505, 0, [{ indent: null, code: 4 }])]);
		raw([route(-1, [moveUp])[0] as EventCommand, cmd(505, 0, [step(4, undefined, 0)])]);
		// Steps of other shapes.
		raw(route(-1, [{ code: 4, indent: 1 }]));
		raw(route(-1, [{ code: 4 }]));
		raw(route(-1, [{ code: 4, parameters: [], indent: null }]));
		raw(route(-1, [{ code: 15, indent: null, parameters: [15] }]));
		raw(route(-1, [step(15)]));
		raw(route(-1, [step(15, [15, 1])]));
		raw(route(-1, [step(0)]));
		raw(route(-1, [step(46)]));
		raw(route(-1, [step(45, ["two\nlines"])]));
		raw(route(-3, [moveUp]));
	});
});

describe("characters of a map event", () => {
	const page = (list: EventCommand[]): EventPage =>
		({
			conditions: {
				switch1Valid: false,
				switch1Id: 1,
				switch2Valid: false,
				switch2Id: 1,
				variableValid: false,
				variableId: 1,
				variableValue: 0,
				selfSwitchValid: false,
				selfSwitchCh: "A",
				itemValid: false,
				itemId: 1,
				actorValid: false,
				actorId: 1,
			},
			trigger: 0,
			list: [...list, END],
		}) as EventPage;
	const mapEvent = (id: number, name: string, list: EventCommand[] = []) =>
		({ id, name, note: "", x: 0, y: 0, pages: [page(list)] }) as MapEvent;

	it("refers to the map's other events by name when the name is unique", async () => {
		const events = [
			null,
			mapEvent(1, "Gate", [
				cmd(212, 0, [2, 1, false]),
				cmd(212, 0, [3, 1, false]),
				cmd(212, 0, [4, 1, false]),
				cmd(212, 0, [5, 1, false]),
				cmd(212, 0, [6, 1, false]),
				cmd(212, 0, [9, 1, false]),
				cmd(111, 0, [6, 2, 8]),
				cmd(0, 1),
				cmd(412, 0),
				cmd(122, 0, [1, 1, 0, 3, 5, 3, 0]),
			]),
			mapEvent(2, "Old gate"),
			mapEvent(3, "Guard"),
			mapEvent(4, "Guard"),
			mapEvent(5, ""),
			mapEvent(6, "new"),
		];
		const containers: ScriptContainer[] = [
			{ kind: "mapEvent", mapId: 3, id: 1, event: events[1] as MapEvent, mapEvents: events },
		];
		const script = decompileDocument(containers, context);
		expect(script.text).toContain(
			[
				'\t\tshowAnimation(map.events["Old gate"], animations.Slash);',
				"\t\tshowAnimation(map.events[3], animations.Slash);",
				"\t\tshowAnimation(map.events[4], animations.Slash);",
				"\t\tshowAnimation(map.events[5], animations.Slash);",
				"\t\tshowAnimation(map.events.new, animations.Slash);",
				"\t\tshowAnimation(map.events[9], animations.Slash);",
				'\t\tif (map.events["Old gate"].direction === "up") {',
				"\t\t}",
				"\t\tvariables.To_map = map.events[3].x;",
			].join("\n"),
		);
		await expectPrettierStable(script);

		// Without the map's events, and in common events, events are referred to by id.
		const byId = decompileDocument(
			[{ kind: "mapEvent", mapId: 3, id: 1, event: events[1] as MapEvent }],
			context,
		);
		expect(byId.text).toContain("showAnimation(map.events[2], animations.Slash);");
	});

	it("breaks the arguments of a long first call of a route", async () => {
		const name = "The guard who stands at the gate of the old town all day long";
		const routes = [
			...route(2, [step(1)], { repeat: true, skippable: true, wait: false }),
			...route(2, [step(1), step(2)], { repeat: true, skippable: true, wait: false }),
		];
		const events = [null, mapEvent(1, "Gate", routes), mapEvent(2, name)];
		const script = decompileDocument(
			[{ kind: "mapEvent", mapId: 3, id: 1, event: events[1] as MapEvent, mapEvents: events }],
			context,
		);
		expect(script.text).toContain(
			[
				`\t\tsetMovementRoute(map.events["${name}"], {`,
				"\t\t\trepeat: true,",
				"\t\t\tskippable: true,",
				"\t\t\twait: false,",
				"\t\t}).moveDown();",
				`\t\tsetMovementRoute(map.events["${name}"], {`,
				"\t\t\trepeat: true,",
				"\t\t\tskippable: true,",
				"\t\t\twait: false,",
				"\t\t})",
				"\t\t\t.moveDown()",
				"\t\t\t.moveLeft();",
			].join("\n"),
		);
		await expectPrettierStable(script);
	});
});

describeWithGame("movement renderers on the configured test game", (game) => {
	it(
		"prints every movement, character, screen, audio and picture command with dedicated syntax",
		{ timeout: 120_000 },
		async () => {
			const project = await loadProject(game);
			// Count the nodes each renderer declines. Commands inside blocks printed raw (such as
			// choices, until #42) never reach a renderer, so they aren't counted.
			const declined = new Map<number, number>();
			const renderers = new Map(
				[...RENDERERS].map(([code, renderer]): [number, CommandRenderer] => [
					code,
					(node, renderContext) => {
						const doc = renderer(node, renderContext);
						if (doc === undefined) {
							declined.set(code, (declined.get(code) ?? 0) + 1);
						}
						return doc;
					},
				]),
			);
			const decompileContext = { symbols: project.symbols, renderers };
			const scripts: DecompiledScript[] = [
				decompileDocument(
					project.commonEvents.flatMap((event, id) =>
						event ? [{ kind: "commonEvent" as const, id, commonEvent: event }] : [],
					),
					decompileContext,
				),
				decompileDocument(
					project.troops.flatMap((troop, id) =>
						troop ? [{ kind: "troop" as const, id, troop }] : [],
					),
					decompileContext,
				),
			];
			for (const mapId of project.mapIds()) {
				const map = await project.map(mapId);
				scripts.push(
					decompileDocument(
						map.events.flatMap((event, id) =>
							event ? [{ kind: "mapEvent" as const, mapId, id, event, mapEvents: map.events }] : [],
						),
						decompileContext,
					),
				);
			}
			const coverage = sumCoverage(scripts.map((script) => script.coverage));
			const raw = [...coverage.rawByCode.values()].reduce((sum, count) => sum + count, 0);
			console.log(
				`movement renderers: raw fallback now ${raw} of ${coverage.commands} commands ` +
					`(${((100 * raw) / coverage.commands).toFixed(1)}%); declined: ` +
					JSON.stringify(Object.fromEntries(declined)),
			);
			expect(Object.fromEntries(declined)).toEqual({});
		},
	);
});
