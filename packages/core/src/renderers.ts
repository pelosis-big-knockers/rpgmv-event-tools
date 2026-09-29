import type { EventCommand } from "./commands.js";
import { FLOW_RENDERERS } from "./flow-renderers.js";
import type { Doc } from "./layout.js";
import type { BlockNode, CommandNode, StructureNode } from "./structure.js";
import type { MvSymbols } from "./symbols.js";

/**
 * What a renderer gets to work with. Renderers print one structure node (a command with its
 * continuation lines, or a block) as dedicated script syntax.
 */
export interface RenderContext {
	/** The command list the node indexes into. */
	readonly list: readonly EventCommand[];
	readonly symbols: MvSymbols;
	/** The indent the node's own commands are expected to have (the nesting depth). */
	readonly depth: number;
	/** Whether the node is inside the body of a `loop`, so a Break Loop leaves that loop. */
	readonly inLoop: boolean;
	/**
	 * Prints the body of one of the node's branches: its statements, one level deeper, each with
	 * its source-map segment. `loop` marks the body of a loop.
	 */
	body(nodes: readonly StructureNode[], options?: { loop?: boolean }): Doc[];
	/**
	 * Prints `node`, one level deeper, with its own renderer only: `undefined` if it has none or
	 * the renderer declines. Used to fold a nested block into this one, as in `else if`.
	 */
	nested(node: StructureNode): Doc | undefined;
	/** Wraps `doc` in a source-map segment for commands `[start, end)` of the list. */
	segment(start: number, end: number, doc: Doc): Doc;
	/** Records that the node uses the running event, so the body declares its parameter. */
	useEvent(): void;
}

/**
 * Prints a node as dedicated syntax: a complete statement, including the `;`. Returns `undefined`
 * when the node's data can't be printed so that it compiles back to the identical commands; the
 * node then uses the raw fallback.
 *
 * The printer only calls a renderer when the node's own commands (for a block: the opener,
 * branch headers, terminators and closer) are plain `{ code, indent, parameters }` objects, and
 * its terminators and closer have no parameters, so renderers only check parameters.
 */
export type CommandRenderer = (
	node: CommandNode | BlockNode,
	context: RenderContext,
) => Doc | undefined;

/**
 * The built-in renderers, by command code. Commands without one print with the raw fallback,
 * `command(code, [parameters])`. Each command group adds its renderers here.
 */
export const RENDERERS: ReadonlyMap<number, CommandRenderer> = new Map<number, CommandRenderer>(
	FLOW_RENDERERS,
);
