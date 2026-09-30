import type { ContainerRef } from "@rpgmv-event-tools/core";

/**
 * Paths of `rpgmv:` script documents. This module doesn't use the VS Code API, so it can be
 * tested on its own; the extension turns the paths into `Uri`s.
 *
 * A document's path names its project and container by id, and ends with the container's name
 * as the tab title:
 *
 * - `/<project>/common-events/3/Rain sounds.mvscript`
 * - `/<project>/maps/12/events/4/Old gate.mvscript`
 * - `/<project>/troops/7/Cave bats.mvscript`
 *
 * Only the ids find the data, so a document stays valid when its container is renamed.
 * `<project>` is a project's key in the session, which may itself contain `/`.
 */

/** The URI scheme of script documents. */
export const SCRIPT_SCHEME = "rpgmv";

/** The file extension of script documents, which gives them the `rpgmv-script` language. */
export const SCRIPT_EXTENSION = ".mvscript";

/** The project and container a script document shows. */
export interface ScriptAddress {
	/** The project's key in the session. */
	readonly projectKey: string;
	readonly container: ContainerRef;
}

/** The path of the document showing `address`, with `name` (the container's name) as its title. */
export function formatScriptPath(address: ScriptAddress, name: string): string {
	return `/${address.projectKey}/${containerSegments(address.container).join("/")}/${fileName(name, address.container)}`;
}

/**
 * The project and container of a script document's path, or `undefined` if the path isn't one.
 * The last segment (the title) is ignored.
 */
export function parseScriptPath(path: string): ScriptAddress | undefined {
	const segments = path.split("/");
	if (segments[0] !== "" || segments.length < 5) {
		return undefined;
	}
	// The container's segments have a fixed length, so they are read from the end.
	const tail = segments.slice(-5, -1);
	const container: ContainerRef | undefined =
		tail[0] === "maps" && tail[2] === "events"
			? mapEventRef(tail[1], tail[3])
			: tail[2] === "common-events"
				? idRef(tail[3], (commonEventId) => ({ kind: "commonEvent", commonEventId }))
				: tail[2] === "troops"
					? idRef(tail[3], (troopId) => ({ kind: "troop", troopId }))
					: undefined;
	if (!container) {
		return undefined;
	}
	const projectSegments = segments.slice(1, -1 - containerSegments(container).length);
	if (projectSegments.length === 0 || projectSegments.some((segment) => segment === "")) {
		return undefined;
	}
	return { projectKey: projectSegments.join("/"), container };
}

/** A key that is the same for every path of one container, whatever its title. */
export function addressKey(address: ScriptAddress): string {
	return `${address.projectKey}/${containerSegments(address.container).join("/")}`;
}

/** Whether two refs are the same container. */
export function sameContainer(a: ContainerRef, b: ContainerRef): boolean {
	return containerSegments(a).join("/") === containerSegments(b).join("/");
}

function containerSegments(container: ContainerRef): string[] {
	switch (container.kind) {
		case "commonEvent":
			return ["common-events", String(container.commonEventId)];
		case "mapEvent":
			return ["maps", String(container.mapId), "events", String(container.eventId)];
		case "troop":
			return ["troops", String(container.troopId)];
	}
}

/**
 * The title segment: the name with path separators and control characters replaced, or a
 * description of the container when the name is blank.
 */
function fileName(name: string, container: ContainerRef): string {
	// oxlint-disable-next-line no-control-regex -- control characters are what's being replaced
	const cleaned = name.replace(/[/\\\u0000-\u001f\u007f]/g, "_").trim();
	return `${cleaned || untitled(container)}${SCRIPT_EXTENSION}`;
}

function untitled(container: ContainerRef): string {
	switch (container.kind) {
		case "commonEvent":
			return `Common event ${container.commonEventId}`;
		case "mapEvent":
			return `Event ${container.eventId}`;
		case "troop":
			return `Troop ${container.troopId}`;
	}
}

function mapEventRef(
	mapSegment: string | undefined,
	eventSegment: string | undefined,
): ContainerRef | undefined {
	const mapId = parseId(mapSegment);
	const eventId = parseId(eventSegment);
	return mapId !== undefined && eventId !== undefined
		? { kind: "mapEvent", mapId, eventId }
		: undefined;
}

function idRef(
	segment: string | undefined,
	ref: (id: number) => ContainerRef,
): ContainerRef | undefined {
	const id = parseId(segment);
	return id === undefined ? undefined : ref(id);
}

/** A positive integer id, written without leading zeros. */
function parseId(segment: string | undefined): number | undefined {
	return segment !== undefined && /^[1-9]\d{0,8}$/.test(segment) ? Number(segment) : undefined;
}
