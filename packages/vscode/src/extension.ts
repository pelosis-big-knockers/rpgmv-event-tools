import {
	findProjects,
	loadProject,
	summarizeProject,
	type MvProjectLocation,
} from "@rpgmv-event-tools/core";
import * as vscode from "vscode";

let log: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext): void {
	log = vscode.window.createOutputChannel("RPG Maker MV", { log: true });
	context.subscriptions.push(
		log,
		vscode.workspace.onDidChangeWorkspaceFolders((event) => void scanFolders(event.added)),
	);
	void scanFolders(vscode.workspace.workspaceFolders ?? []);
}

export function deactivate(): void {}

async function scanFolders(folders: readonly vscode.WorkspaceFolder[]): Promise<void> {
	for (const folder of folders) {
		if (folder.uri.scheme !== "file") {
			log.info(`Skipping ${folder.uri.toString()}: only local folders are supported.`);
			continue;
		}
		try {
			const projects = await findProjects(folder.uri.fsPath);
			if (projects.length === 0) {
				log.info(`No RPG Maker MV project found in ${folder.uri.fsPath}.`);
			}
			for (const project of projects) {
				await logProject(project);
			}
		} catch (error) {
			log.error(`Failed to search ${folder.uri.fsPath} for projects:`, error);
		}
	}
}

async function logProject(project: MvProjectLocation): Promise<void> {
	log.info(`Found RPG Maker MV project (${project.layout} layout) at ${project.gameDir}`);
	try {
		const summary = summarizeProject(await loadProject(project));
		const counts = [
			count(summary.commonEvents, "common event"),
			count(summary.maps, "map"),
			count(summary.switches, "switch", "switches"),
			count(summary.variables, "variable"),
		];
		log.info(`  "${summary.title}": ${counts.join(", ")}`);
	} catch (error) {
		log.warn(`  Could not read the project's data files in ${project.dataDir}:`, error);
	}
}

function count(n: number, singular: string, plural = `${singular}s`): string {
	return `${n} ${n === 1 ? singular : plural}`;
}
