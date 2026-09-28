/**
 * Core library for RPG Maker MV event data. It has no VS Code dependency so it can
 * also back a CLI or other tools.
 */
export const CORE_VERSION = "0.0.0";

export {
	EVENT_COMMANDS,
	MOVE_ROUTE_COMMANDS,
	commandName,
	getCommandInfo,
	getMoveCommandInfo,
	isContinuation,
	type CommandCategory,
	type CommandInfo,
	type CommandRole,
	type EventCommand,
	type MoveCommand,
	type MoveCommandInfo,
	type ParameterInfo,
	type ParameterType,
} from "./commands.js";
export {
	mvJsonLayout,
	parseMvJson,
	readMvFile,
	stringifyMvJson,
	writeMvFile,
	type MvJsonLayout,
} from "./mv-json.js";
export {
	findProjects,
	resolveMvProject,
	type FindProjectsOptions,
	type MvLayout,
	type MvProjectLocation,
} from "./project.js";
export { readProjectSummary, type MvProjectSummary } from "./summary.js";
