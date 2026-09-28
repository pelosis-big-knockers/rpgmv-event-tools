import { describe, expect, it } from "vitest";
import {
	buildStructure,
	checkStructure,
	loadProject,
	locationKey,
	walkStructure,
	type BlockBranch,
	type EventCommand,
	type RawReason,
	type StructureNode,
} from "../src/index.js";
import { describeWithGame } from "./support/test-game.js";

/** A command list from `[code, indent]` pairs. Parameters don't matter to the structure pass. */
function list(...commands: [code: number, indent: number][]): EventCommand[] {
	return commands.map(([code, indent]) => ({ code, indent, parameters: [] }));
}

/** Builds the tree and checks that it partitions the list. */
function structure(commands: EventCommand[]): StructureNode[] {
	const nodes = buildStructure(commands);
	expect(checkStructure(nodes, commands.length)).toBeUndefined();
	return nodes;
}

const command = (start: number, end: number, code: number): StructureNode => ({
	kind: "command",
	start,
	end,
	code,
});
const end = (index: number): StructureNode => ({ kind: "end", start: index, end: index + 1 });
const raw = (start: number, end: number, reason: RawReason): StructureNode => ({
	kind: "raw",
	start,
	end,
	reason,
});
const branch = (
	headerIndex: number,
	headerCode: number,
	terminatorIndex: number,
	body: StructureNode[] = [],
): BlockBranch => ({
	start: headerIndex,
	end: terminatorIndex + 1,
	headerIndex,
	headerCode,
	body,
	terminatorIndex,
});
const block = (start: number, code: number, closeIndex: number, branches: BlockBranch[]) => ({
	kind: "block" as const,
	start,
	end: closeIndex + 1,
	code,
	branches,
	closeIndex,
});

describe("buildStructure on canonical lists", () => {
	it("groups commands with their continuation lines", () => {
		const commands = list([101, 0], [401, 0], [401, 0], [221, 0], [355, 0], [655, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			command(0, 3, 101),
			command(3, 4, 221),
			command(4, 6, 355),
			end(6),
		]);
	});

	it("handles an empty list, and a list that is only its end", () => {
		expect(structure([])).toEqual([]);
		expect(structure(list([0, 0]))).toEqual([end(0)]);
	});

	it("builds a conditional branch without else", () => {
		const commands = list([111, 0], [101, 1], [401, 1], [0, 1], [412, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			block(0, 111, 4, [branch(0, 111, 3, [command(1, 3, 101)])]),
			end(5),
		]);
	});

	it("builds a conditional branch with else and empty bodies", () => {
		const commands = list([111, 0], [0, 1], [411, 0], [0, 1], [412, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			block(0, 111, 4, [branch(0, 111, 1), branch(2, 411, 3)]),
			end(5),
		]);
	});

	it("builds nested blocks: a branch in a loop, with break loop", () => {
		const commands = list(
			[112, 0],
			[111, 1],
			[113, 2],
			[0, 2],
			[411, 1],
			[230, 2],
			[0, 2],
			[412, 1],
			[0, 1],
			[413, 0],
			[0, 0],
		);
		expect(structure(commands)).toEqual([
			block(0, 112, 9, [
				branch(0, 112, 8, [
					block(1, 111, 7, [
						branch(1, 111, 3, [command(2, 3, 113)]),
						branch(4, 411, 6, [command(5, 6, 230)]),
					]),
				]),
			]),
			end(10),
		]);
	});

	it("builds show choices with several choices and a cancel branch", () => {
		const commands = list(
			[102, 0],
			[402, 0],
			[221, 1],
			[0, 1],
			[402, 0],
			[0, 1],
			[403, 0],
			[101, 1],
			[401, 1],
			[0, 1],
			[404, 0],
			[0, 0],
		);
		expect(structure(commands)).toEqual([
			block(0, 102, 10, [
				branch(1, 402, 3, [command(2, 3, 221)]),
				branch(4, 402, 5),
				branch(6, 403, 9, [command(7, 9, 101)]),
			]),
			end(11),
		]);
	});

	it("treats battle processing without branches as a plain command", () => {
		const commands = list([301, 0], [221, 0], [0, 0]);
		expect(structure(commands)).toEqual([command(0, 1, 301), command(1, 2, 221), end(2)]);
	});

	it("builds battle processing with win, escape and lose branches", () => {
		const commands = list(
			[301, 1],
			[601, 1],
			[0, 2],
			[602, 1],
			[121, 2],
			[0, 2],
			[603, 1],
			[0, 2],
			[604, 1],
		);
		// Structured as the body of a loop, so it sits at indent 1.
		const loop = list([112, 0], ...commands.map((c) => [c.code, c.indent] as [number, number]));
		loop.push(...list([0, 1], [413, 0], [0, 0]));
		expect(structure(loop)).toEqual([
			block(0, 112, 11, [
				branch(0, 112, 10, [
					block(1, 301, 9, [
						branch(2, 601, 3),
						branch(4, 602, 6, [command(5, 6, 121)]),
						branch(7, 603, 8),
					]),
				]),
			]),
			end(12),
		]);
	});

	it("handles very deep nesting without recursion", () => {
		const depth = 5000;
		const commands: EventCommand[] = [];
		for (let level = 0; level < depth; level++) {
			commands.push(...list([111, level]));
		}
		commands.push(...list([221, depth]));
		for (let level = depth - 1; level >= 0; level--) {
			commands.push(...list([0, level + 1], [412, level]));
		}
		commands.push(...list([0, 0]));

		const nodes = structure(commands);
		expect(nodes).toHaveLength(2);
		const all = [...walkStructure(nodes)];
		expect(all.filter((node) => node.kind === "block")).toHaveLength(depth);
		expect(all.filter((node) => node.kind === "raw")).toHaveLength(0);
	});
});

describe("buildStructure on malformed lists", () => {
	it("keeps an unknown code as a raw node", () => {
		const commands = list([9000, 0], [221, 0], [0, 0]);
		expect(structure(commands)).toEqual([raw(0, 1, "unknownCode"), command(1, 2, 221), end(2)]);
	});

	it("keeps a run of unexpectedly deep commands as one raw node", () => {
		const commands = list([221, 0], [221, 2], [111, 1], [221, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			command(0, 1, 221),
			raw(1, 3, "unexpectedIndent"),
			command(3, 4, 221),
			end(4),
		]);
	});

	it("keeps commands with a negative or missing indent as raw nodes", () => {
		const commands: EventCommand[] = [
			{ code: 221, indent: -1, parameters: [] },
			{ code: 221, parameters: [] } as unknown as EventCommand,
			...list([0, 0]),
		];
		expect(structure(commands)).toEqual([
			raw(0, 1, "unexpectedIndent"),
			raw(1, 2, "unexpectedIndent"),
			end(2),
		]);
	});

	it("keeps orphaned continuation lines as raw nodes, one per run", () => {
		const commands = list([401, 0], [401, 0], [405, 0], [105, 0], [401, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			raw(0, 2, "orphanedContinuation"),
			raw(2, 3, "orphanedContinuation"),
			command(3, 4, 105),
			raw(4, 5, "orphanedContinuation"),
			end(5),
		]);
	});

	it("keeps orphaned branches and block ends as raw nodes", () => {
		const commands = list([411, 0], [0, 1], [412, 0], [404, 0], [601, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			raw(0, 1, "orphanedBranch"),
			raw(1, 2, "unexpectedIndent"),
			raw(2, 3, "orphanedClose"),
			raw(3, 4, "orphanedClose"),
			raw(4, 5, "orphanedBranch"),
			end(5),
		]);
	});

	it("keeps an indent-0 end before the last command as a raw node", () => {
		const commands = list([0, 0], [221, 0], [0, 0]);
		expect(structure(commands)).toEqual([raw(0, 1, "unexpectedEnd"), command(1, 2, 221), end(2)]);
	});

	it("has no end node when the list doesn't end with an indent-0 end", () => {
		expect(structure(list([221, 0]))).toEqual([command(0, 1, 221)]);
		expect(structure(list([221, 0], [0, 1]))).toEqual([
			command(0, 1, 221),
			raw(1, 2, "unexpectedIndent"),
		]);
	});

	it("makes the opener raw when a block has no closer", () => {
		const commands = list([111, 0], [221, 1], [0, 1], [221, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			raw(0, 1, "malformedBlock"),
			raw(1, 3, "unexpectedIndent"),
			command(3, 4, 221),
			end(4),
		]);
	});

	it("makes the opener raw when a body has no terminator", () => {
		const commands = list([111, 0], [221, 1], [412, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			raw(0, 1, "malformedBlock"),
			raw(1, 2, "unexpectedIndent"),
			raw(2, 3, "orphanedClose"),
			end(3),
		]);
	});

	it("makes the opener raw when the list ends inside a block", () => {
		const commands = list([112, 0], [221, 1], [0, 1]);
		expect(structure(commands)).toEqual([
			raw(0, 1, "malformedBlock"),
			raw(1, 3, "unexpectedIndent"),
		]);
	});

	it("makes show choices raw when no choice follows it", () => {
		const commands = list([102, 0], [221, 0], [404, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			raw(0, 1, "malformedBlock"),
			command(1, 2, 221),
			raw(2, 3, "orphanedClose"),
			end(3),
		]);
	});

	it("makes the opener raw when a branch or closer of another block follows a body", () => {
		const commands = list([111, 0], [0, 1], [413, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			raw(0, 1, "malformedBlock"),
			raw(1, 2, "unexpectedIndent"),
			raw(2, 3, "orphanedClose"),
			end(3),
		]);
	});

	it("keeps the enclosing block when only an inner block is malformed", () => {
		// The inner conditional branch is missing its 412.
		const commands = list([112, 0], [111, 1], [221, 2], [0, 2], [0, 1], [413, 0], [0, 0]);
		expect(structure(commands)).toEqual([
			block(0, 112, 5, [
				branch(0, 112, 4, [raw(1, 2, "malformedBlock"), raw(2, 4, "unexpectedIndent")]),
			]),
			end(6),
		]);
	});
});

describe("checkStructure", () => {
	it("reports gaps, overlaps and a wrong total length", () => {
		expect(checkStructure([command(0, 1, 221), end(2)], 3)).toMatch(/doesn't start at 1/);
		expect(checkStructure([command(0, 2, 101), end(1)], 2)).toMatch(/doesn't start at 2/);
		expect(checkStructure([command(0, 1, 221)], 2)).toMatch(/expected 2/);
	});

	it("reports a branch body that doesn't fill its branch", () => {
		const nodes = [block(0, 111, 3, [branch(0, 111, 2, [command(1, 2, 221)])])];
		expect(checkStructure(nodes, 4)).toBeUndefined();
		const broken = [block(0, 111, 3, [branch(0, 111, 2, [])])];
		expect(checkStructure(broken, 4)).toMatch(/expected 2/);
	});
});

describeWithGame("buildStructure on the configured test game", (game) => {
	it("structures every command list and partitions it exactly", { timeout: 60_000 }, async () => {
		const project = await loadProject(game);
		const lists: { key: string; list: EventCommand[] }[] = [];
		for await (const { location, list } of project.commandLists()) {
			lists.push({ key: locationKey(location), list });
		}

		const started = performance.now();
		const trees = lists.map(({ list }) => buildStructure(list));
		const elapsed = performance.now() - started;

		let commands = 0;
		const problems: string[] = [];
		const rawByReason = new Map<RawReason, number>();
		const blocksByCode = new Map<number, number>();
		let plainBattles = 0;
		for (const [index, { key, list }] of lists.entries()) {
			const nodes = trees[index] as StructureNode[];
			commands += list.length;
			const problem = checkStructure(nodes, list.length);
			if (problem) {
				problems.push(`${key}: ${problem}`);
			}
			if (nodes.at(-1)?.kind !== "end") {
				problems.push(`${key}: no end node`);
			}
			for (const node of walkStructure(nodes)) {
				if (node.kind === "raw") {
					rawByReason.set(node.reason, (rawByReason.get(node.reason) ?? 0) + 1);
				} else if (node.kind === "block") {
					blocksByCode.set(node.code, (blocksByCode.get(node.code) ?? 0) + 1);
				} else if (node.kind === "command" && node.code === 301) {
					plainBattles++;
				}
			}
		}

		console.log(
			`structure pass: ${lists.length} lists, ${commands} commands in ${elapsed.toFixed(0)} ms; ` +
				`blocks by code: ${JSON.stringify(Object.fromEntries(blocksByCode))}, ` +
				`battles without branches: ${plainBattles}; ` +
				`raw nodes: ${JSON.stringify(Object.fromEntries(rawByReason))}`,
		);
		expect(problems.slice(0, 10)).toEqual([]);
		expect(Object.fromEntries(rawByReason)).toEqual({});
	});
});
