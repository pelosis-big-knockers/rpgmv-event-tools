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
	MvDataError,
	asCommonEvents,
	asMap,
	asMapInfos,
	asSystem,
	asTroops,
	commonEventLists,
	describeLocation,
	locationKey,
	mapEventLists,
	mapIdFromFileName,
	troopLists,
	type CommonEvent,
	type EventImage,
	type EventPage,
	type EventPageConditions,
	type ListLocation,
	type LocatedCommandList,
	type MapEvent,
	type MapInfo,
	type MoveRoute,
	type MvMap,
	type MvSystem,
	type Troop,
	type TroopMember,
	type TroopPage,
	type TroopPageConditions,
} from "./models.js";
export {
	mvJsonLayout,
	parseMvJson,
	readMvFile,
	stringifyMvJson,
	writeMvFile,
	type MvJsonLayout,
} from "./mv-json.js";
export { MvProject, loadProject, mapFileName } from "./mv-project.js";
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
export { summarizeProject, type MvProjectSummary } from "./summary.js";
