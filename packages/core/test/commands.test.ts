import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EVENT_COMMANDS,
	MOVE_ROUTE_COMMANDS,
	commandName,
	getCommandInfo,
	getMoveCommandInfo,
	isContinuation,
	readMvFile,
	type EventCommand,
	type MoveCommand,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

describe("event command catalog", () => {
	it("has one entry per code, with unique names", () => {
		const codes = EVENT_COMMANDS.map((info) => info.code);
		expect(new Set(codes).size).toBe(codes.length);
		// Continuation lines share a label with their head command, but names are unique.
		const names = EVENT_COMMANDS.map((info) => info.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("looks up commands by code", () => {
		expect(getCommandInfo(101)).toMatchObject({ name: "showText", label: "Show Text" });
		expect(getCommandInfo(121)?.parameters.map((p) => p.type)).toEqual([
			"switchId",
			"switchId",
			"enum",
		]);
		expect(getCommandInfo(999)).toBeUndefined();
	});

	it("names unknown codes instead of throwing", () => {
		expect(commandName(117)).toBe("commonEvent");
		expect(commandName(357)).toBe("unknown357");
	});

	it("marks the continuation lines of multi-line commands", () => {
		const continuations = EVENT_COMMANDS.flatMap((info) =>
			info.role.kind === "continuation" ? [[info.code, info.role.of]] : [],
		);
		expect(continuations).toEqual([
			[401, 101],
			[405, 105],
			[408, 108],
			[505, 205],
			[605, 302],
			[655, 355],
		]);
		expect(isContinuation(401)).toBe(true);
		expect(isContinuation(101)).toBe(false);
		expect(isContinuation(999)).toBe(false);
	});

	it("gives every block exactly one end, and lists its branches", () => {
		const blocks = EVENT_COMMANDS.filter((info) => info.role.kind === "opensBlock").map(
			(info) => info.code,
		);
		expect(blocks).toEqual([102, 111, 112, 301]);

		const partsOf = (code: number, kind: "branch" | "closesBlock") =>
			EVENT_COMMANDS.flatMap((info) =>
				info.role.kind === kind && info.role.of === code ? [info.code] : [],
			);
		for (const block of blocks) {
			expect(partsOf(block, "closesBlock"), `end of ${block}`).toHaveLength(1);
		}
		expect(partsOf(102, "branch")).toEqual([402, 403]);
		expect(partsOf(111, "branch")).toEqual([411]);
		expect(partsOf(112, "branch")).toEqual([]);
		expect(partsOf(301, "branch")).toEqual([601, 602, 603]);
	});

	it("points every role's `of` at a command in the catalog", () => {
		for (const info of EVENT_COMMANDS) {
			if ("of" in info.role) {
				expect(
					getCommandInfo(info.role.of),
					`${info.code} refers to ${info.role.of}`,
				).toBeDefined();
			}
		}
	});

	it("lists values only for enum parameters", () => {
		for (const info of EVENT_COMMANDS) {
			for (const parameter of info.parameters) {
				expect(parameter.values !== undefined, `${info.name}.${parameter.name}`).toBe(
					parameter.type === "enum",
				);
			}
		}
	});
});

describe("move route command catalog", () => {
	it("covers codes 0 to 45 without gaps", () => {
		expect(MOVE_ROUTE_COMMANDS.map((info) => info.code)).toEqual(
			Array.from({ length: 46 }, (_, i) => i),
		);
	});

	it("looks up commands by code", () => {
		expect(getMoveCommandInfo(14)).toMatchObject({ name: "jump", label: "Jump" });
		expect(getMoveCommandInfo(14)?.parameters).toHaveLength(2);
		expect(getMoveCommandInfo(46)).toBeUndefined();
	});
});

interface RawPage {
	list: EventCommand[];
	moveRoute?: { list: MoveCommand[] };
}
interface RawEvent {
	id: number;
	pages: RawPage[];
}

const isMapFile = (name: string) => /^Map\d+\.json$/.test(name);

/** Every command list in the game, with a readable location for failure messages. */
async function* commandLists(dataDir: string): AsyncGenerator<[string, EventCommand[]]> {
	const commonEvents = (await readMvFile(join(dataDir, "CommonEvents.json"))) as ({
		id: number;
		list: EventCommand[];
	} | null)[];
	for (const event of commonEvents) {
		if (event) {
			yield [`CommonEvents.json #${event.id}`, event.list];
		}
	}
	for (const troop of (await readMvFile(join(dataDir, "Troops.json"))) as (RawEvent | null)[]) {
		for (const [page, { list }] of (troop?.pages ?? []).entries()) {
			yield [`Troops.json #${troop?.id} page ${page + 1}`, list];
		}
	}
	for (const [name, event] of await mapEvents(dataDir)) {
		for (const [page, { list }] of event.pages.entries()) {
			yield [`${name} event #${event.id} page ${page + 1}`, list];
		}
	}
}

async function mapEvents(dataDir: string): Promise<[string, RawEvent][]> {
	const result: [string, RawEvent][] = [];
	for (const name of (await readdir(dataDir)).filter(isMapFile)) {
		const map = (await readMvFile(join(dataDir, name))) as { events: (RawEvent | null)[] };
		for (const event of map.events) {
			if (event) {
				result.push([name, event]);
			}
		}
	}
	return result;
}

/** Move routes of map event pages and of Set Movement Route commands. */
async function* moveRoutes(dataDir: string): AsyncGenerator<[string, MoveCommand[]]> {
	for await (const [where, list] of commandLists(dataDir)) {
		for (const command of list) {
			if (command.code === 205) {
				yield [where, (command.parameters[1] as { list: MoveCommand[] }).list];
			}
		}
	}
	for (const [name, event] of await mapEvents(dataDir)) {
		for (const page of event.pages) {
			yield [`${name} event #${event.id}`, page.moveRoute?.list ?? []];
		}
	}
}

describeWithGame("command catalog against the configured test game", (game) => {
	it("knows every event command code the game uses, and all its parameter positions", async () => {
		const problems = new Set<string>();
		for await (const [where, list] of commandLists(game.dataDir)) {
			for (const { code, parameters } of list) {
				const info = getCommandInfo(code);
				if (!info) {
					problems.add(`unknown code ${code} (first seen in ${where})`);
				} else if (parameters.length > info.parameters.length) {
					problems.add(
						`${code} ${info.name}: ${parameters.length} parameters, catalog has ${info.parameters.length}`,
					);
				}
			}
		}
		expect([...problems]).toEqual([]);
	});

	it("knows every move route command code the game uses", async () => {
		const problems = new Set<string>();
		for await (const [where, list] of moveRoutes(game.dataDir)) {
			for (const { code, parameters = [] } of list) {
				const info = getMoveCommandInfo(code);
				if (!info || parameters.length > info.parameters.length) {
					problems.add(`move command ${code} (first seen in ${where})`);
				}
			}
		}
		expect([...problems]).toEqual([]);
	});

	it("sees continuation lines only right after their head command", async () => {
		const problems: string[] = [];
		for await (const [where, list] of commandLists(game.dataDir)) {
			list.forEach(({ code }, index) => {
				const role = getCommandInfo(code)?.role;
				if (role?.kind === "continuation") {
					const previous = list[index - 1]?.code;
					if (previous !== role.of && previous !== code) {
						problems.push(`${where} command ${index}: ${code} after ${previous}`);
					}
				}
			});
		}
		expect(problems.slice(0, 10)).toEqual([]);
	});

	const interpreter = join(game.gameDir, "js", "rpg_objects.js");
	it.skipIf(!existsSync(interpreter))(
		"has an entry for every Game_Interpreter command method in js/rpg_objects.js",
		async () => {
			const source = await readFile(interpreter, "utf8");
			const codes = [...source.matchAll(/Game_Interpreter\.prototype\.command(\d+)\s*=/g)].map(
				(match) => Number(match[1]),
			);
			expect(codes.length).toBeGreaterThan(100);
			expect(codes.filter((code) => !getCommandInfo(code))).toEqual([]);
		},
	);
});
