/**
 * Core library for RPG Maker MV event data. It has no VS Code dependency so it can
 * also back a CLI or other tools.
 */
export const CORE_VERSION = "0.0.0";

export {
	mvJsonLayout,
	parseMvJson,
	readMvFile,
	stringifyMvJson,
	writeMvFile,
	type MvJsonLayout,
} from "./mv-json.js";
export {
	DATABASE_FILES,
	MvNames,
	SYSTEM_NAME_LISTS,
	createNames,
	loadNames,
	type DatabaseKind,
	type NamedKind,
	type SystemNameKind,
} from "./names.js";
export {
	findProjects,
	resolveMvProject,
	type FindProjectsOptions,
	type MvLayout,
	type MvProjectLocation,
} from "./project.js";
export { readProjectSummary, type MvProjectSummary } from "./summary.js";
