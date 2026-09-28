/**
 * Core library for RPG Maker MV event data. It has no VS Code dependency so it can
 * also back a CLI or other tools.
 */
export const CORE_VERSION = "0.0.0";

export {
	findProjects,
	resolveMvProject,
	type FindProjectsOptions,
	type MvLayout,
	type MvProjectLocation,
} from "./project.js";
export { readProjectSummary, type MvProjectSummary } from "./summary.js";

// Deliberate CI failure check (to be reverted).
const unusedForCiCheck = 1;
export const   badlyFormatted={a:1}
