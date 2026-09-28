/**
 * The structure pass: turns a flat event command list into a tree of commands and blocks.
 *
 * Nodes don't copy commands. They hold `[start, end)` ranges of indexes into the list they were
 * built from, so the top-level nodes of a list partition `0..list.length` exactly. Ranges include
 * the commands a script leaves out (branch `0` terminators, block ends, the list's final `0`),
 * which makes them the basis for a source map.
 *
 * Canonical layout (what MV's editor writes):
 *
 * - Continuation lines (401 after 101, 405 after 105, …) follow their head at the same indent.
 * - 111 If: a body one level deeper ending with a `0`, then optionally 411 Else with its own body
 *   and `0`, then 412 End at the 111's indent. 112 Loop is the same with no branches and 413.
 * - 102 Show Choices is followed directly by its first 402 When. Each 402/403 branch has a body
 *   ending with a `0`, and 404 closes the block.
 * - 301 Battle Processing is a block only when one of its branches (601/602/603) follows it
 *   directly; the branches are closed by 604. Otherwise it's a plain command.
 * - The list ends with a `0` at indent 0.
 *
 * Anything else becomes raw nodes; see {@link buildStructure} for the recovery rules.
 */

import { getCommandInfo, type EventCommand } from "./commands.js";

/** A `[start, end)` range of command indexes. */
export interface IndexRange {
	readonly start: number;
	readonly end: number;
}

/**
 * A command that stands alone, together with its continuation lines (for example 101 Show Text
 * and its 401 lines). The head is at `start` and the lines are `start + 1` to `end - 1`.
 */
export interface CommandNode extends IndexRange {
	readonly kind: "command";
	readonly code: number;
}

/**
 * One branch of a block: a header command, a body one indent level deeper, and the `0` that
 * ends the body. Covers `[headerIndex, terminatorIndex + 1)`.
 *
 * For 111 If and 112 Loop the first branch has no header command of its own: its header is the
 * opener (`headerIndex === block.start`, `headerCode` 111 or 112). Later branches, and every
 * branch of 102 and 301, start with a branch command (411, 402, 403, 601, 602, 603).
 */
export interface BlockBranch extends IndexRange {
	readonly headerIndex: number;
	readonly headerCode: number;
	/** Nodes of the body, partitioning `[headerIndex + 1, terminatorIndex)`. */
	readonly body: readonly StructureNode[];
	readonly terminatorIndex: number;
}

/**
 * A block (111 If, 112 Loop, 102 Show Choices, 301 Battle Processing with branches). The opener
 * is at `start` and the closer (412, 413, 404, 604) at `closeIndex`, which is `end - 1`.
 *
 * The block's range is partitioned by the opener (unless the first branch starts at it), the
 * branches in order, and the closer.
 */
export interface BlockNode extends IndexRange {
	readonly kind: "block";
	readonly code: number;
	readonly branches: readonly BlockBranch[];
	readonly closeIndex: number;
}

/** The `0` that ends the whole list. Only ever the last top-level node. */
export interface EndNode extends IndexRange {
	readonly kind: "end";
}

/** Why a range of commands couldn't be structured. */
export type RawReason =
	/** A code the catalog doesn't know, such as one added by a plugin. */
	| "unknownCode"
	/** Deeper than the enclosing body, or a negative or missing indent. */
	| "unexpectedIndent"
	/** Continuation lines with no head command of their kind before them. */
	| "orphanedContinuation"
	/** A branch command (402, 411, 601, …) outside a block it belongs to. */
	| "orphanedBranch"
	/** A block end (404, 412, 413, 604) outside a block it closes. */
	| "orphanedClose"
	/** A `0` at indent 0 that isn't the last command of the list. */
	| "unexpectedEnd"
	/** A block opener whose branches, terminators or closer don't follow the canonical layout. */
	| "malformedBlock";

/** Commands kept as they are because they don't match the expected structure. */
export interface RawNode extends IndexRange {
	readonly kind: "raw";
	readonly reason: RawReason;
}

export type StructureNode = CommandNode | BlockNode | EndNode | RawNode;

/** Openers whose first branch is the opener itself rather than a branch command after it. */
const IMPLICIT_FIRST_BRANCH = new Set([111, 112]);

/** Battle Processing, which is a block only when a branch follows it. */
const BATTLE_PROCESSING = 301;

/** A block being built, while its current branch body is parsed. */
interface OpenBlock {
	readonly start: number;
	readonly code: number;
	readonly indent: number;
	readonly branches: BlockBranch[];
	headerIndex: number;
	body: StructureNode[];
}

/**
 * Builds the structure tree of a command list. The returned top-level nodes partition
 * `0..list.length` exactly. A canonical list ends with an {@link EndNode}; a list whose last
 * command isn't a `0` at indent 0 has none.
 *
 * Never throws. Commands that don't fit become {@link RawNode}s covering exactly those indexes,
 * and parsing carries on after them:
 *
 * - An unknown code is a raw node of its own.
 * - A run of commands deeper than the current body is one raw node (`unexpectedIndent`), even if
 *   it would structure on its own.
 * - A run of continuation lines with the same code and no head is one raw node.
 * - A branch command, block end or non-final indent-0 `0` found where no block expects it is a
 *   raw node of its own.
 * - When a block doesn't complete (a body isn't ended by a `0` one level deeper, or the next
 *   command after a terminator is neither a branch of the block nor its closer), only the opener
 *   becomes raw (`malformedBlock`). Parsing restarts right after the opener, so its bodies become
 *   `unexpectedIndent` runs and its branch commands and closer become orphans.
 *
 * Runs in time linear in the list length for canonical lists, and uses no recursion, so nesting
 * depth is unlimited.
 */
export function buildStructure(list: readonly EventCommand[]): StructureNode[] {
	const length = list.length;
	const code = (index: number): unknown => list[index]?.code;
	const indent = (index: number): number => {
		const value = list[index]?.indent;
		return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : -1;
	};
	const roleOf = (index: number) => {
		const value = code(index);
		return typeof value === "number" ? getCommandInfo(value)?.role : undefined;
	};
	const isRole = (index: number, kind: "branch" | "closesBlock", of: number, at: number) => {
		const role = roleOf(index);
		return index < length && role?.kind === kind && role.of === of && indent(index) === at;
	};

	const root: StructureNode[] = [];
	const open: OpenBlock[] = [];
	let i = 0;

	const raw = (body: StructureNode[], start: number, end: number, reason: RawReason) =>
		body.push({ kind: "raw", start, end, reason });

	// Abandons the innermost open block: its opener becomes raw and parsing restarts after it.
	const abandon = (block: OpenBlock) => {
		open.pop();
		raw(open.at(-1)?.body ?? root, block.start, block.start + 1, "malformedBlock");
		i = block.start + 1;
	};

	while (true) {
		const block = open.at(-1);
		const body = block?.body ?? root;
		const depth = block ? block.indent + 1 : 0;

		if (i >= length) {
			if (!block) {
				break;
			}
			abandon(block);
			continue;
		}

		const at = indent(i);
		if (at < depth) {
			if (block) {
				abandon(block);
			} else {
				raw(body, i, i + 1, "unexpectedIndent");
				i++;
			}
			continue;
		}
		if (at > depth) {
			const start = i;
			while (i < length && indent(i) > depth) {
				i++;
			}
			raw(body, start, i, "unexpectedIndent");
			continue;
		}

		const role = roleOf(i);
		if (!role) {
			raw(body, i, i + 1, "unknownCode");
			i++;
			continue;
		}
		switch (role.kind) {
			case "end":
				if (block) {
					// The body's terminator: the branch is complete.
					block.branches.push({
						start: block.headerIndex,
						end: i + 1,
						headerIndex: block.headerIndex,
						headerCode: code(block.headerIndex) as number,
						body: block.body,
						terminatorIndex: i,
					});
					i++;
					if (isRole(i, "branch", block.code, block.indent)) {
						block.headerIndex = i;
						block.body = [];
						i++;
					} else if (isRole(i, "closesBlock", block.code, block.indent)) {
						open.pop();
						(open.at(-1)?.body ?? root).push({
							kind: "block",
							start: block.start,
							end: i + 1,
							code: block.code,
							branches: block.branches,
							closeIndex: i,
						});
						i++;
					} else {
						abandon(block);
					}
				} else {
					if (i === length - 1) {
						root.push({ kind: "end", start: i, end: i + 1 });
					} else {
						raw(root, i, i + 1, "unexpectedEnd");
					}
					i++;
				}
				break;
			case "command":
			case "opensBlock": {
				const opener = code(i) as number;
				const implicit = IMPLICIT_FIRST_BRANCH.has(opener);
				if (role.kind === "opensBlock" && (implicit || isRole(i + 1, "branch", opener, at))) {
					open.push({
						start: i,
						code: opener,
						indent: at,
						branches: [],
						headerIndex: implicit ? i : i + 1,
						body: [],
					});
					i += implicit ? 1 : 2;
				} else if (role.kind === "opensBlock" && opener !== BATTLE_PROCESSING) {
					raw(body, i, i + 1, "malformedBlock");
					i++;
				} else {
					const start = i;
					i++;
					while (i < length && indent(i) === at) {
						const next = roleOf(i);
						if (next?.kind !== "continuation" || next.of !== opener) {
							break;
						}
						i++;
					}
					body.push({ kind: "command", start, end: i, code: opener });
				}
				break;
			}
			case "continuation": {
				const start = i;
				const line = code(i);
				while (i < length && code(i) === line && indent(i) === at) {
					i++;
				}
				raw(body, start, i, "orphanedContinuation");
				break;
			}
			case "branch":
				raw(body, i, i + 1, "orphanedBranch");
				i++;
				break;
			case "closesBlock":
				raw(body, i, i + 1, "orphanedClose");
				i++;
				break;
		}
	}
	return root;
}

/** Every node of a tree, depth first in list order, including those inside branch bodies. */
export function* walkStructure(nodes: readonly StructureNode[]): Generator<StructureNode> {
	const stack: StructureNode[] = [...nodes].reverse();
	while (stack.length > 0) {
		const node = stack.pop() as StructureNode;
		yield node;
		if (node.kind === "block") {
			for (let b = node.branches.length - 1; b >= 0; b--) {
				const body = (node.branches[b] as BlockBranch).body;
				for (let n = body.length - 1; n >= 0; n--) {
					stack.push(body[n] as StructureNode);
				}
			}
		}
	}
}

/**
 * Checks that a tree covers `0..length` exactly once: top-level nodes are contiguous, and
 * within every block the opener, branches (header, body, terminator) and closer are too.
 * Returns a description of the first problem, or `undefined` when the tree is consistent.
 */
export function checkStructure(
	nodes: readonly StructureNode[],
	length: number,
): string | undefined {
	// Each entry is a sequence of nodes that must partition [start, end).
	const pending: { nodes: readonly StructureNode[]; start: number; end: number }[] = [
		{ nodes, start: 0, end: length },
	];
	while (pending.length > 0) {
		const { nodes: sequence, start, end } = pending.pop() as (typeof pending)[number];
		let at = start;
		for (const node of sequence) {
			if (node.start !== at || node.end <= node.start) {
				return `node ${node.kind} [${node.start}, ${node.end}) doesn't start at ${at}`;
			}
			if (node.kind === "block") {
				if (node.branches.length === 0) {
					return `block at ${node.start} has no branches`;
				}
				// The first branch starts at the opener (111, 112) or right after it (102, 301).
				let inner = node.branches[0]?.headerIndex === node.start ? node.start : node.start + 1;
				for (const branch of node.branches) {
					if (branch.headerIndex !== inner) {
						return `branch at ${branch.headerIndex} of block at ${node.start} doesn't start at ${inner}`;
					}
					if (branch.start !== inner || branch.end !== branch.terminatorIndex + 1) {
						return `branch at ${inner} has range [${branch.start}, ${branch.end})`;
					}
					pending.push({ nodes: branch.body, start: inner + 1, end: branch.terminatorIndex });
					inner = branch.end;
				}
				if (node.closeIndex !== inner || node.end !== inner + 1) {
					return `block at ${node.start} closes at ${node.closeIndex}, expected ${inner}`;
				}
			}
			at = node.end;
		}
		if (at !== end) {
			return `nodes end at ${at}, expected ${end}`;
		}
	}
	return undefined;
}
