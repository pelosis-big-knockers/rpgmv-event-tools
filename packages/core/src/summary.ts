import type { MvProject } from "./mv-project.js";

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

/** Counts what a loaded project holds. Doesn't load any maps. */
export function summarizeProject(project: MvProject): MvProjectSummary {
	return {
		title: project.system.gameTitle,
		commonEvents: project.commonEvents.filter((event) => event !== null).length,
		maps: project.mapIds().length,
		switches: project.names.count("switch"),
		variables: project.names.count("variable"),
	};
}
