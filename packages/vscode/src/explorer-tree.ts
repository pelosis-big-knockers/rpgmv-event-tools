import {
	mapFileName,
	summarizePage,
	type EventCommand,
	type MapInfo,
	type MvProject,
	type ScriptContainer,
} from "@rpgmv-event-tools/core";
import type { SessionProject } from "./project-session.js";
import { containerPath, containerRef } from "./script-documents.js";
import { addressKey } from "./script-uri.js";

/**
 * The data of the explorer's tree: which nodes it has, how they nest, and their labels,
 * descriptions and tooltips. This module doesn't use the VS Code API, so it can be tested on its
 * own; the extension turns nodes into tree items.
 *
 * - With one project, the top level is its categories; with several, it lists the projects,
 *   each with its categories.
 * - Common Events lists common events by id: `3 · Rain sounds`.
 * - Maps nests maps as the MV editor does, by `parentId` and `order` in `MapInfos.json`. A map
 *   lists its child maps, then its events by id, and its file loads the first time it's
 *   expanded.
 * - Troops lists troops by id.
 * - Map events and troops list their pages: `Page 1`, `Page 2` and so on.
 *
 * Empty slots are hidden unless `showEmptyEntries` is set: common events without a name or
 * commands, and troops without a name or commands on any page. The MV editor leaves such slots
 * when the database's maximum is raised. Map events are never hidden: every event on a map was
 * placed there, and the editor names new events (`EV001`), so even one without commands can show
 * a picture or block the way.
 */

/** Options that change which nodes the tree has. */
export interface ExplorerOptions {
	/** Show the empty slots of common events and troops. */
	showEmptyEntries: boolean;
}

/** Where the projects come from: a `ProjectSession`, or a stand-in in tests. */
export interface ExplorerSource {
	readonly projects: readonly SessionProject[];
	/** Resolves when every project being loaded has loaded. */
	whenLoaded(): Promise<void>;
}

/** The kinds of category under a project. */
export type ExplorerCategory = "commonEvents" | "maps" | "troops";

/** What a tooltip shows: a line of text, then optionally a block of script. */
export interface ExplorerTooltip {
	readonly text: string;
	/** Script, shown as a code block in the `rpgmv-script` language. */
	readonly code?: string;
}

/** The script document a node opens when clicked. */
export interface ExplorerTarget {
	/** The document's `rpgmv:` path (see `script-uri.ts`). */
	readonly path: string;
	/** The page to scroll to. */
	readonly pageIndex?: number;
}

interface NodeBase {
	/** Unique in the tree, and the same for the same entry each time the tree is built. */
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly tooltip?: ExplorerTooltip;
	/** Whether the node can have children. */
	readonly collapsible: boolean;
	readonly open?: ExplorerTarget;
	/** The node this one is listed under, or `undefined` at the top level. */
	readonly parent: ExplorerNode | undefined;
}

/** A node of the tree. */
export type ExplorerNode =
	| (NodeBase & { readonly kind: "project"; readonly project: SessionProject })
	| (NodeBase & {
			readonly kind: "category";
			readonly project: SessionProject;
			readonly category: ExplorerCategory;
	  })
	| (NodeBase & { readonly kind: "map"; readonly project: SessionProject; readonly mapId: number })
	| (NodeBase & {
			readonly kind: "container";
			readonly project: SessionProject;
			readonly container: ScriptContainer;
	  })
	| (NodeBase & {
			readonly kind: "page";
			readonly project: SessionProject;
			readonly container: ScriptContainer;
			readonly pageIndex: number;
	  })
	/** Something that went wrong while listing its parent's children, such as a missing map. */
	| (NodeBase & { readonly kind: "message" });

const CATEGORY_LABELS: Record<ExplorerCategory, string> = {
	commonEvents: "Common Events",
	maps: "Maps",
	troops: "Troops",
};

const CATEGORY_SEGMENTS: Record<ExplorerCategory, string> = {
	commonEvents: "common-events",
	maps: "maps",
	troops: "troops",
};

const COMMON_EVENT_TRIGGERS = ["none", "autorun", "parallel"];

/** Builds the tree's nodes from the projects of an {@link ExplorerSource}, level by level. */
export class ExplorerTree {
	readonly #source: ExplorerSource;
	readonly options: ExplorerOptions;
	/** Each `MapInfos.json` array's maps by parent id, in the editor's order. */
	readonly #mapsByParent = new WeakMap<readonly (MapInfo | null)[], Map<number, MapInfo[]>>();

	constructor(source: ExplorerSource, options: ExplorerOptions = { showEmptyEntries: false }) {
		this.#source = source;
		this.options = options;
	}

	/**
	 * The children of `node`, or the top level without it. The top level waits for projects
	 * still loading; a map's children wait for its file to load.
	 */
	async children(node?: ExplorerNode): Promise<ExplorerNode[]> {
		if (!node) {
			await this.#source.whenLoaded();
			const projects = this.#source.projects;
			const only = projects.length === 1 ? projects[0] : undefined;
			return only
				? this.#categories(only, undefined)
				: projects.map((project) => projectNode(project));
		}
		switch (node.kind) {
			case "project":
				return this.#categories(node.project, node);
			case "category":
				return this.#categoryChildren(node);
			case "map":
				return this.#mapChildren(node);
			case "container":
				return pageNodes(node);
			case "page":
			case "message":
				return [];
		}
	}

	#categories(project: SessionProject, parent: ExplorerNode | undefined): ExplorerNode[] {
		const counts: Record<ExplorerCategory, number> = {
			commonEvents: this.#commonEvents(project.project).length,
			maps: project.project.mapIds().length,
			troops: this.#troops(project.project).length,
		};
		return (Object.keys(CATEGORY_LABELS) as ExplorerCategory[]).map((category) => ({
			kind: "category",
			id: `category:${project.key}/${CATEGORY_SEGMENTS[category]}`,
			label: CATEGORY_LABELS[category],
			description: String(counts[category]),
			collapsible: true,
			parent,
			project,
			category,
		}));
	}

	#categoryChildren(node: ExplorerNode & { kind: "category" }): ExplorerNode[] {
		const { project } = node;
		switch (node.category) {
			case "commonEvents":
				return this.#commonEvents(project.project).map((container) =>
					containerNode(project, container, node),
				);
			case "maps":
				return this.#childMaps(project, 0, node);
			case "troops":
				return this.#troops(project.project).map((container) =>
					containerNode(project, container, node),
				);
		}
	}

	async #mapChildren(node: ExplorerNode & { kind: "map" }): Promise<ExplorerNode[]> {
		const { project, mapId } = node;
		const maps = this.#childMaps(project, mapId, node);
		let events;
		try {
			events = (await project.project.map(mapId)).events;
		} catch (error) {
			return [
				...maps,
				{
					kind: "message",
					id: `message:${node.id}`,
					label: `Couldn't load ${mapFileName(mapId)}`,
					tooltip: { text: error instanceof Error ? error.message : String(error) },
					collapsible: false,
					parent: node,
				},
			];
		}
		const eventNodes = events.flatMap((event, id) =>
			event
				? [containerNode(project, { kind: "mapEvent", mapId, id, event, mapEvents: events }, node)]
				: [],
		);
		return [...maps, ...eventNodes];
	}

	/** The maps listed directly under `parentId` (0 for the top level), in the editor's order. */
	#childMaps(project: SessionProject, parentId: number, parent: ExplorerNode): ExplorerNode[] {
		const infos = project.project.mapInfos;
		let byParent = this.#mapsByParent.get(infos);
		if (!byParent) {
			byParent = mapsByParent(infos);
			this.#mapsByParent.set(infos, byParent);
		}
		return (byParent.get(parentId) ?? []).map((info) => ({
			kind: "map",
			id: `map:${project.key}/maps/${info.id}`,
			label: entryLabel(info.id, info.name),
			collapsible: true,
			parent,
			project,
			mapId: info.id,
		}));
	}

	#commonEvents(project: MvProject): ScriptContainer[] {
		return project.commonEvents.flatMap((commonEvent, id) =>
			commonEvent &&
			(this.options.showEmptyEntries ||
				!isBlank(commonEvent.name) ||
				!isEmptyList(commonEvent.list))
				? [{ kind: "commonEvent" as const, id, commonEvent }]
				: [],
		);
	}

	#troops(project: MvProject): ScriptContainer[] {
		return project.troops.flatMap((troop, id) =>
			troop &&
			(this.options.showEmptyEntries ||
				!isBlank(troop.name) ||
				!troop.pages.every((page) => isEmptyList(page.list)))
				? [{ kind: "troop" as const, id, troop }]
				: [],
		);
	}
}

/**
 * Maps by the id of the map they're listed under, each list in the editor's order. Maps whose
 * parent isn't listed are listed at the top level (0).
 */
function mapsByParent(infos: readonly (MapInfo | null)[]): Map<number, MapInfo[]> {
	const byParent = new Map<number, MapInfo[]>();
	for (const info of infos) {
		if (!info) {
			continue;
		}
		const parentId = info.parentId !== info.id && infos[info.parentId] ? info.parentId : 0;
		let siblings = byParent.get(parentId);
		if (!siblings) {
			siblings = [];
			byParent.set(parentId, siblings);
		}
		siblings.push(info);
	}
	for (const siblings of byParent.values()) {
		siblings.sort((a, b) => a.order - b.order || a.id - b.id);
	}
	return byParent;
}

function projectNode(project: SessionProject): ExplorerNode {
	return {
		kind: "project",
		id: `project:${project.key}`,
		label: project.project.system.gameTitle || project.key,
		description: project.key,
		tooltip: { text: project.project.location.gameDir },
		collapsible: true,
		parent: undefined,
		project,
	};
}

function containerNode(
	project: SessionProject,
	container: ScriptContainer,
	parent: ExplorerNode,
): ExplorerNode {
	const base = {
		kind: "container",
		id: `container:${containerId(project.key, container)}`,
		parent,
		project,
		container,
		open: { path: containerPath(project.key, container) },
	} as const;
	switch (container.kind) {
		case "commonEvent": {
			const { commonEvent } = container;
			const trigger = COMMON_EVENT_TRIGGERS[commonEvent.trigger] ?? String(commonEvent.trigger);
			const description =
				commonEvent.trigger === 0
					? undefined
					: `${trigger} · ${project.project.symbols.format("switch", commonEvent.switchId)}`;
			return {
				...base,
				label: entryLabel(container.id, commonEvent.name),
				...(description === undefined ? {} : { description }),
				collapsible: false,
			};
		}
		case "mapEvent": {
			const { event } = container;
			return {
				...base,
				label: entryLabel(container.id, event.name),
				description: `(${event.x}, ${event.y})`,
				collapsible: event.pages.length > 0,
			};
		}
		case "troop":
			return {
				...base,
				label: entryLabel(container.id, container.troop.name),
				collapsible: container.troop.pages.length > 0,
			};
	}
}

function pageNodes(node: ExplorerNode & { kind: "container" }): ExplorerNode[] {
	const { project, container } = node;
	const pages =
		container.kind === "mapEvent"
			? container.event.pages.map((page) => ({ kind: "mapEvent" as const, page }))
			: container.kind === "troop"
				? container.troop.pages.map((page) => ({ kind: "troop" as const, page }))
				: [];
	const context = { symbols: project.project.symbols };
	return pages.map((page, pageIndex) => {
		const { options, summary } = summarizePage(page, context);
		const label = `Page ${pageIndex + 1}`;
		return {
			kind: "page",
			id: `page:${containerId(project.key, container)}/pages/${pageIndex}`,
			label,
			description: summary,
			tooltip: { text: label, code: options },
			collapsible: false,
			open: { path: containerPath(project.key, container), pageIndex },
			parent: node,
			project,
			container,
			pageIndex,
		};
	});
}

/** `3 · Rain sounds`, or just the id for an entry without a name. */
function entryLabel(id: number, name: string): string {
	return isBlank(name) ? String(id) : `${id} · ${name}`;
}

/** A container's place in the project, as in its document's path. */
function containerId(projectKey: string, container: ScriptContainer): string {
	return addressKey({ projectKey, container: containerRef(container) });
}

function isBlank(name: string): boolean {
	return name.trim() === "";
}

/** Whether a command list has no commands besides the final `0`. */
function isEmptyList(list: readonly EventCommand[]): boolean {
	return list.every((command) => command.code === 0);
}
