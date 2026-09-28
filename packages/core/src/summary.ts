import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MvProjectLocation } from "./project.js";

/** Headline numbers for a project, for logging and status display. */
export interface MvProjectSummary {
	title: string;
	commonEvents: number;
	maps: number;
	/** Number of switch slots. Slot 0 is unused, so ids run from 1 to this number. */
	switches: number;
	/** Number of variable slots. Slot 0 is unused, so ids run from 1 to this number. */
	variables: number;
}

/**
 * Reads `System.json`, `CommonEvents.json` and `MapInfos.json` and counts what they hold.
 * Throws if a file is missing or not in the expected shape.
 */
export async function readProjectSummary(project: MvProjectLocation): Promise<MvProjectSummary> {
	const [system, commonEvents, mapInfos] = await Promise.all([
		readDataFile(project, "System.json"),
		readDataFile(project, "CommonEvents.json"),
		readDataFile(project, "MapInfos.json"),
	]);

	if (!isRecord(system)) {
		throw new Error(`System.json is not an object in ${project.dataDir}`);
	}
	return {
		title: typeof system["gameTitle"] === "string" ? system["gameTitle"] : "",
		commonEvents: countEntries(commonEvents, "CommonEvents.json"),
		maps: countEntries(mapInfos, "MapInfos.json"),
		switches: countSlots(system["switches"], "switches"),
		variables: countSlots(system["variables"], "variables"),
	};
}

async function readDataFile(project: MvProjectLocation, name: string): Promise<unknown> {
	const text = await readFile(join(project.dataDir, name), "utf8");
	try {
		// Strip a UTF-8 byte order mark if one is present.
		return JSON.parse(text.replace(/^\uFEFF/, ""));
	} catch (error) {
		throw new Error(`${name} is not valid JSON in ${project.dataDir}`, { cause: error });
	}
}

/** MV database arrays hold `null` at index 0 and for deleted entries. */
function countEntries(value: unknown, name: string): number {
	if (!Array.isArray(value)) {
		throw new Error(`${name} is not an array`);
	}
	return value.filter((entry) => entry !== null).length;
}

function countSlots(value: unknown, name: string): number {
	if (!Array.isArray(value)) {
		throw new Error(`System.json ${name} is not an array`);
	}
	return Math.max(0, value.length - 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
