import {
	decompileDocument,
	type ContainerRef,
	type MvProject,
	type ScriptContainer,
	type ScriptSourceMap,
} from "@rpgmv-event-tools/core";
import type { ProjectSession } from "./project-session.js";
import { addressKey, formatScriptPath, sameContainer, type ScriptAddress } from "./script-uri.js";

/**
 * Script documents for event containers: one document per common event, map event (with all its
 * pages) or troop. This module doesn't use the VS Code API, so it can be tested on its own.
 */

/** A container's decompiled script. */
export interface ScriptDocument {
	readonly text: string;
	readonly sourceMap: ScriptSourceMap;
}

/**
 * The container `ref` points at in `project`, or `undefined` if there is none. A map event's
 * container carries its map's events, so the script refers to them by name.
 */
export async function findContainer(
	project: MvProject,
	ref: ContainerRef,
): Promise<ScriptContainer | undefined> {
	switch (ref.kind) {
		case "commonEvent": {
			const commonEvent = project.commonEvents[ref.commonEventId];
			return commonEvent ? { kind: "commonEvent", id: ref.commonEventId, commonEvent } : undefined;
		}
		case "mapEvent": {
			if (!project.mapInfos[ref.mapId]) {
				return undefined;
			}
			const map = await project.map(ref.mapId);
			const event = map.events[ref.eventId];
			return event
				? { kind: "mapEvent", mapId: ref.mapId, id: ref.eventId, event, mapEvents: map.events }
				: undefined;
		}
		case "troop": {
			const troop = project.troops[ref.troopId];
			return troop ? { kind: "troop", id: ref.troopId, troop } : undefined;
		}
	}
}

/** Decompiles a container into its document. */
export function buildScriptDocument(
	project: MvProject,
	container: ScriptContainer,
): ScriptDocument {
	const { text, sourceMap } = decompileDocument([container], { symbols: project.symbols });
	return { text, sourceMap };
}

/** Which container a `ScriptContainer` is. */
export function containerRef(container: ScriptContainer): ContainerRef {
	switch (container.kind) {
		case "commonEvent":
			return { kind: "commonEvent", commonEventId: container.id };
		case "mapEvent":
			return { kind: "mapEvent", mapId: container.mapId, eventId: container.id };
		case "troop":
			return { kind: "troop", troopId: container.id };
	}
}

/** The path of the document showing `container` of the project with key `projectKey`. */
export function containerPath(projectKey: string, container: ScriptContainer): string {
	const name =
		container.kind === "commonEvent"
			? container.commonEvent.name
			: container.kind === "mapEvent"
				? container.event.name
				: container.troop.name;
	return formatScriptPath({ projectKey, container: containerRef(container) }, name);
}

/**
 * The first line (0-based) of page `pageIndex` of `container` in a document's source map, or
 * `undefined` if the document has no such page.
 */
export function pageStartLine(
	sourceMap: ScriptSourceMap,
	container: ContainerRef,
	pageIndex: number,
): number | undefined {
	const segment = sourceMap.segments.find(
		({ target }) =>
			target.kind === "page" &&
			target.pageIndex === pageIndex &&
			sameContainer(target.container, container),
	);
	return segment?.startLine;
}

/**
 * Builds script documents from the session's projects on request, and keeps each one until it's
 * forgotten, so a page can be found in the document the editor shows.
 */
export class ScriptDocuments {
	readonly #session: ProjectSession;
	/** Documents by `addressKey`. */
	readonly #documents = new Map<string, Promise<ScriptDocument>>();

	constructor(session: ProjectSession) {
		this.#session = session;
	}

	/** The document for `address`, built the first time it's asked for. Rejects if there's none. */
	get(address: ScriptAddress): Promise<ScriptDocument> {
		const key = addressKey(address);
		let document = this.#documents.get(key);
		if (!document) {
			document = this.#build(address);
			this.#documents.set(key, document);
			// A failed build isn't kept, so asking again tries again.
			document.catch(() => {
				if (this.#documents.get(key) === document) {
					this.#documents.delete(key);
				}
			});
		}
		return document;
	}

	/** Drops the kept document for `address`, so the next `get` builds it again. */
	forget(address: ScriptAddress): void {
		this.#documents.delete(addressKey(address));
	}

	async #build(address: ScriptAddress): Promise<ScriptDocument> {
		const entry = await this.#session.project(address.projectKey);
		if (!entry) {
			throw new Error(`No RPG Maker MV project "${address.projectKey}" is open in the workspace.`);
		}
		const container = await findContainer(entry.project, address.container);
		if (!container) {
			throw new Error(`${describeContainer(address.container)} doesn't exist in "${entry.key}".`);
		}
		return buildScriptDocument(entry.project, container);
	}
}

function describeContainer(ref: ContainerRef): string {
	switch (ref.kind) {
		case "commonEvent":
			return `Common event ${ref.commonEventId}`;
		case "mapEvent":
			return `Event ${ref.eventId} of map ${ref.mapId}`;
		case "troop":
			return `Troop ${ref.troopId}`;
	}
}
