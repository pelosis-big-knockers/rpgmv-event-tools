import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * The line layouts the RPG Maker MV editor uses when it saves data files. Matching them exactly
 * keeps saves byte-identical to the editor's, so diffs of edited files stay small.
 *
 * - `lines`: a top-level array with one compact entry per line, as in `CommonEvents.json`,
 *   `Troops.json`, `MapInfos.json` and the other database files.
 * - `map`: a `MapXXX.json` object. Settings go on one line, then `data` on its own line, then
 *   `events` with one event per line.
 * - `compact`: the whole value on one line, as in `System.json`.
 *
 * None of the layouts end with a newline.
 */
export type MvJsonLayout = "lines" | "map" | "compact";

const MAP_FILE = /^Map\d+\.json$/i;

/** Picks the layout the MV editor uses for a data file, from its file name and content. */
export function mvJsonLayout(fileName: string, value: unknown): MvJsonLayout {
	if (MAP_FILE.test(basename(fileName))) {
		return "map";
	}
	return Array.isArray(value) ? "lines" : "compact";
}

/** Parses the text of an MV data file, ignoring a UTF-8 byte order mark if there is one. */
export function parseMvJson(text: string): unknown {
	return JSON.parse(text.startsWith("﻿") ? text.slice(1) : text);
}

/** Serializes a data file's content in the layout the MV editor uses for `fileName`. */
export function stringifyMvJson(fileName: string, value: unknown): string {
	switch (mvJsonLayout(fileName, value)) {
		case "lines":
			return linesArray(value as unknown[]);
		case "map":
			return mapObject(fileName, value);
		case "compact":
			return compact(value);
	}
}

/** Reads and parses an MV data file. */
export async function readMvFile(path: string): Promise<unknown> {
	return parseMvJson(await readFile(path, "utf8"));
}

/** Writes an MV data file in the editor's layout, as UTF-8 without a byte order mark. */
export async function writeMvFile(path: string, value: unknown): Promise<void> {
	await writeFile(path, stringifyMvJson(path, value), "utf8");
}

function compact(value: unknown): string {
	const text = JSON.stringify(value);
	if (text === undefined) {
		throw new Error(`Cannot serialize ${typeof value} as JSON`);
	}
	return text;
}

/** One entry per line. The editor writes an empty array as `[` and `]` on separate lines. */
function linesArray(entries: unknown[]): string {
	if (entries.length === 0) {
		return "[\n]";
	}
	return `[\n${entries.map(compact).join(",\n")}\n]`;
}

function mapObject(fileName: string, value: unknown): string {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${basename(fileName)}: a map file must hold a JSON object`);
	}
	const { data, events, ...settings } = value as Record<string, unknown>;
	if (!Array.isArray(data) || !Array.isArray(events)) {
		throw new Error(`${basename(fileName)}: a map file must have "data" and "events" arrays`);
	}
	// `compact(settings)` is `{...}`; drop the braces to splice its keys into the outer object.
	const settingsLine = compact(settings).slice(1, -1);
	const lines = [settingsLine, `"data":${compact(data)}`, `"events":${linesArray(events)}`];
	return `{\n${lines.filter((line) => line !== "").join(",\n")}\n}`;
}
