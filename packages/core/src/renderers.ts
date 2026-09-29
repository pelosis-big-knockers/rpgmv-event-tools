import type { EventCommand } from "./commands.js";
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
	/**
	 * Prints the body of one of the node's branches: its statements, one level deeper, each with
	 * its source-map segment.
	 */
	body(nodes: readonly StructureNode[]): Doc[];
	/** Wraps `doc` in a source-map segment for commands `[start, end)` of the list. */
	segment(start: number, end: number, doc: Doc): Doc;
	/** Records that the node uses the running event, so the body declares its parameter. */
	useEvent(): void;
}

/**
 * Prints a node as dedicated syntax: a complete statement (or statements joined by hard lines),
 * including the `;`. Returns `undefined` when the node's data can't be printed so that it
 * compiles back to the identical commands; the node then uses the raw fallback.
 */
export type CommandRenderer = (
	node: CommandNode | BlockNode,
	context: RenderContext,
) => Doc | undefined;

/**
 * The built-in renderers, by command code. Commands without one print with the raw fallback,
 * `command(code, [parameters])`. The command groups of #41–#44 add their renderers here.
 */
export const RENDERERS: ReadonlyMap<number, CommandRenderer> = new Map<number, CommandRenderer>();
