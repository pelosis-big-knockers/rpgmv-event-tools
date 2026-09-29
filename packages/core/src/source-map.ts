import { locationKey, type ListLocation } from "./models.js";

/** A common event, map event or troop, as a whole. */
export type ContainerRef =
	| { kind: "commonEvent"; commonEventId: number }
	| { kind: "mapEvent"; mapId: number; eventId: number }
	| { kind: "troop"; troopId: number };

/** What a range of script lines was printed from. */
export type SegmentTarget =
	| { kind: "container"; container: ContainerRef }
	| { kind: "page"; container: ContainerRef; pageIndex: number }
	/** Commands `[start, end)` of the command list at `location`. */
	| { kind: "commands"; location: ListLocation; start: number; end: number };

/** Script lines `startLine` to `endLine` (0-based, inclusive) and what they were printed from. */
export interface ScriptSegment {
	readonly startLine: number;
	readonly endLine: number;
	readonly target: SegmentTarget;
}

export interface LineRange {
	readonly startLine: number;
	readonly endLine: number;
}

/**
 * Maps script lines to the containers, pages and commands they were printed from, and back.
 *
 * Segments nest: a container's segment spans its whole call, a page's its whole `page(…)`, and
 * a block's the whole block, with the segments of its body's commands inside. Every command of
 * every list is covered by exactly one innermost commands segment. Commands the script leaves out
 * (a list's final `0`, a block's terminators and end) belong to the segment of the line that
 * stands for them, such as the closing `}`.
 */
export class ScriptSourceMap {
	/** Every segment, by start line, outer segments before the ones inside them. */
	readonly segments: readonly ScriptSegment[];
	#owners: Map<string, (ScriptSegment | undefined)[]> | undefined;

	constructor(segments: readonly ScriptSegment[]) {
		this.segments = [...segments].sort(
			(a, b) => a.startLine - b.startLine || span(b) - span(a) || rank(a) - rank(b),
		);
	}

	/** The segments containing `line`, innermost first. */
	at(line: number): ScriptSegment[] {
		return this.segments
			.filter((segment) => segment.startLine <= line && line <= segment.endLine)
			.reverse();
	}

	/**
	 * The lines of the innermost commands segment covering command `index` of the list at
	 * `location`, or `undefined` if that command isn't in this script.
	 */
	linesOf(location: ListLocation, index: number): LineRange | undefined {
		const segment = this.#ownerIndex().get(locationKey(location))?.[index];
		return segment && { startLine: segment.startLine, endLine: segment.endLine };
	}

	/**
	 * For each command list in the script, the innermost commands segment of each command index.
	 * Nested segments are always smaller than the ones around them, so assigning from the largest
	 * range to the smallest leaves each index with its innermost segment.
	 */
	#ownerIndex(): Map<string, (ScriptSegment | undefined)[]> {
		if (!this.#owners) {
			this.#owners = new Map();
			const commands = this.segments
				.filter((segment) => segment.target.kind === "commands")
				.sort((a, b) => commandSpan(b) - commandSpan(a));
			for (const segment of commands) {
				const target = segment.target as Extract<SegmentTarget, { kind: "commands" }>;
				const key = locationKey(target.location);
				let owners = this.#owners.get(key);
				if (!owners) {
					owners = [];
					this.#owners.set(key, owners);
				}
				for (let index = target.start; index < target.end; index++) {
					owners[index] = segment;
				}
			}
		}
		return this.#owners;
	}
}

function span(segment: ScriptSegment): number {
	return segment.endLine - segment.startLine;
}

/** Containers before pages before commands, when segments span the same lines. */
function rank(segment: ScriptSegment): number {
	return { container: 0, page: 1, commands: 2 }[segment.target.kind];
}

function commandSpan(segment: ScriptSegment): number {
	const target = segment.target;
	return target.kind === "commands" ? target.end - target.start : 0;
}
