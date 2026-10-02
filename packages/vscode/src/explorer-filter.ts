import type { MapEvent, MapInfo, MvProject } from "@rpgmv-event-tools/core";

/**
 * Filtering the explorer's tree: which entries match a filter, and which maps to keep so the
 * matches can be reached. This module doesn't use the VS Code API, so it can be tested on its own;
 * `ExplorerTree` applies a filter set in its options.
 *
 * - Containers (common events, map events and troops) match by name, case-insensitively, or by
 *   id: `12` or `#12`.
 * - Maps match by name, and a matching map shows all its events.
 * - Only loaded maps' events can match: `loadMaps` loads the rest, and the tree shows more matches
 *   as they load.
 */

/** A filter for the explorer's tree, made from what the user typed. */
export class ExplorerFilter {
	/** What the user typed, trimmed. */
	readonly text: string;
	readonly #name: string;
	readonly #id: number | undefined;
	/** Whether any event of a loaded map's `events` matches, by array. */
	readonly #eventMatches = new WeakMap<readonly (MapEvent | null)[], boolean>();

	private constructor(text: string) {
		this.text = text;
		this.#name = text.toLowerCase();
		const id = /^#?(\d+)$/.exec(text)?.[1];
		this.#id = id === undefined ? undefined : Number(id);
	}

	/** The filter for `text`, or `undefined` if it's blank. */
	static parse(text: string): ExplorerFilter | undefined {
		const trimmed = text.trim();
		return trimmed ? new ExplorerFilter(trimmed) : undefined;
	}

	/** Whether a common event, map event or troop matches, by its id or name. */
	matches(id: number, name: string): boolean {
		return id === this.#id || this.matchesName(name);
	}

	/** Whether `name` contains the filter's text, ignoring case. Maps match this way. */
	matchesName(name: string): boolean {
		return name.toLowerCase().includes(this.#name);
	}

	/**
	 * The ids of the maps to show: maps whose name matches, maps with a matching event, and the
	 * maps they're listed under.
	 *
	 * @param events A map's events, or `undefined` if it isn't loaded yet.
	 */
	mapsToShow(
		infos: readonly (MapInfo | null)[],
		events: (mapId: number) => readonly (MapEvent | null)[] | undefined,
	): Set<number> {
		const shown = new Set<number>();
		for (const info of infos) {
			if (!info || !(this.matchesName(info.name) || this.#hasMatchingEvent(events(info.id)))) {
				continue;
			}
			// Adds the map and the maps it's listed under, stopping at one already added.
			for (let id = info.id; id !== 0 && !shown.has(id);) {
				shown.add(id);
				const each = infos[id];
				id = each ? listedParentId(infos, each) : 0;
			}
		}
		return shown;
	}

	/** Whether to show a map's events: all of them if its name matches, else the matching ones. */
	eventsToShow(info: MapInfo | null | undefined): (id: number, event: MapEvent) => boolean {
		return info && this.matchesName(info.name)
			? () => true
			: (id, event) => this.matches(id, event.name);
	}

	#hasMatchingEvent(events: readonly (MapEvent | null)[] | undefined): boolean {
		if (!events) {
			return false;
		}
		let found = this.#eventMatches.get(events);
		if (found === undefined) {
			found = events.some((event, id) => event !== null && this.matches(id, event.name));
			this.#eventMatches.set(events, found);
		}
		return found;
	}
}

/**
 * The id of the map `info` is listed under in the tree, or 0 for the top level. A map whose
 * parent isn't listed is listed at the top level.
 */
export function listedParentId(infos: readonly (MapInfo | null)[], info: MapInfo): number {
	return info.parentId !== info.id && infos[info.parentId] ? info.parentId : 0;
}

/** How `loadMaps` reports progress and is stopped. */
export interface LoadMapsOptions {
	/** Stops loading more maps once aborted. Maps already being read still finish. */
	readonly signal?: AbortSignal;
	/** Called after each map loads or fails to load. */
	readonly onProgress?: (done: number, total: number) => void;
}

/** How many map files `loadMaps` reads at a time. */
const MAP_LOADS_AT_ONCE = 8;

/**
 * Loads every map of `projects` that isn't loaded yet, so a filter can search their events.
 * Maps that fail to load are skipped: the tree shows the error when such a map is expanded.
 */
export async function loadMaps(
	projects: readonly MvProject[],
	options: LoadMapsOptions = {},
): Promise<void> {
	const pending = projects.flatMap((project) =>
		project
			.mapIds()
			.filter((mapId) => !project.isMapLoaded(mapId))
			.map((mapId) => ({ project, mapId })),
	);
	let next = 0;
	let done = 0;
	const worker = async () => {
		while (next < pending.length && !options.signal?.aborted) {
			const { project, mapId } = pending[next++]!;
			await project.map(mapId).catch(() => undefined);
			done++;
			if (!options.signal?.aborted) {
				options.onProgress?.(done, pending.length);
			}
		}
	};
	await Promise.all(Array.from({ length: MAP_LOADS_AT_ONCE }, worker));
}
