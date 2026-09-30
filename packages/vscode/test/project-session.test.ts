import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, type MvProjectLocation } from "@rpgmv-event-tools/core";
import { describe, expect, it } from "vitest";
import {
	ProjectSession,
	projectKey,
	type SessionLoader,
	type SessionLog,
} from "../src/project-session.js";

const FIXTURE = fileURLToPath(new URL("../../core/test/fixtures/basic", import.meta.url));

/** A log that keeps its messages. */
function recordingLog(): SessionLog & { messages: string[] } {
	const messages: string[] = [];
	return {
		messages,
		info: (message) => messages.push(message),
		error: (message, error) => messages.push(`${message} ${String(error)}`),
	};
}

/** The fixture's location, as if it were at `gameDir`. */
function fixtureAt(gameDir: string): MvProjectLocation {
	return { gameDir, dataDir: join(FIXTURE, "data"), layout: "flat" };
}

/**
 * A loader that finds the fixture at each of `gameDirs` under the folder it's given. Projects
 * load from the fixture's data folder, whatever their `gameDir`.
 */
function fixtureLoader(gameDirs: Record<string, string[]>): SessionLoader {
	return {
		findProjects: async (folder) => (gameDirs[folder] ?? []).map(fixtureAt),
		loadProject,
	};
}

describe("projectKey", () => {
	it("is the folder's name, then the game's path in it", () => {
		const folder = { name: "Games", path: resolve("/work/games") };
		expect(projectKey(folder, folder.path)).toBe("Games");
		expect(projectKey(folder, resolve("/work/games/Fear/www"))).toBe("Games/Fear/www");
	});

	it("replaces separators in the folder's name", () => {
		expect(projectKey({ name: "a/b", path: resolve("/x") }, resolve("/x"))).toBe("a_b");
	});
});

describe("ProjectSession", () => {
	it("loads the projects of the basic fixture", async () => {
		const log = recordingLog();
		const session = new ProjectSession(log);
		await session.addFolder({ name: "basic", path: FIXTURE });
		expect(session.projects.map((entry) => entry.key)).toEqual(["basic"]);
		const entry = await session.project("basic");
		expect(entry?.project.system.gameTitle).toBe("Fixture Game");
		expect(log.messages).toEqual([
			expect.stringMatching(/^Loaded "Fixture Game" \(flat layout\) from .* as rpgmv:\/basic: /),
		]);
	});

	it("loads several projects in one folder, each with its own key", async () => {
		const root = resolve("/work");
		const session = new ProjectSession(
			recordingLog(),
			fixtureLoader({ [root]: [join(root, "One"), join(root, "Two", "www")] }),
		);
		await session.addFolder({ name: "work", path: root });
		expect(session.projects.map((entry) => entry.key)).toEqual(["work/One", "work/Two/www"]);
	});

	it("makes keys unique across folders with the same name", async () => {
		const [a, b] = [resolve("/a/games"), resolve("/b/games")];
		const session = new ProjectSession(recordingLog(), fixtureLoader({ [a]: [a], [b]: [b] }));
		await session.addFolder({ name: "games", path: a });
		await session.addFolder({ name: "games", path: b });
		const keys = session.projects.map((entry) => [entry.key, entry.folder.path]);
		expect(keys).toEqual([
			["games", a],
			["games (2)", b],
		]);
	});

	it("forgets a removed folder's projects, even ones still loading", async () => {
		const [a, b] = [resolve("/a"), resolve("/b")];
		const session = new ProjectSession(recordingLog(), fixtureLoader({ [a]: [a], [b]: [b] }));
		await session.addFolder({ name: "a", path: a });
		const loadingB = session.addFolder({ name: "b", path: b });
		session.removeFolder(a);
		session.removeFolder(b);
		await loadingB;
		expect(session.projects).toEqual([]);
		expect(await session.project("a")).toBeUndefined();
	});

	it("keeps one copy of a folder added again while it loads", async () => {
		const a = resolve("/a");
		const session = new ProjectSession(recordingLog(), fixtureLoader({ [a]: [a] }));
		const first = session.addFolder({ name: "a", path: a });
		await session.addFolder({ name: "a", path: a });
		await first;
		expect(session.projects.map((entry) => entry.key)).toEqual(["a"]);
	});

	it("waits for folders still loading before looking up a project", async () => {
		const session = new ProjectSession(recordingLog());
		void session.addFolder({ name: "basic", path: FIXTURE });
		expect((await session.project("basic"))?.key).toBe("basic");
	});

	it("logs projects that fail to load, and loads the others", async () => {
		const root = resolve("/work");
		const loader = fixtureLoader({ [root]: [join(root, "Good"), join(root, "Bad")] });
		const log = recordingLog();
		const session = new ProjectSession(log, {
			findProjects: loader.findProjects,
			loadProject: (location) =>
				location.gameDir.endsWith("Bad")
					? Promise.reject(new Error("broken System.json"))
					: loader.loadProject(location),
		});
		await session.addFolder({ name: "work", path: root });
		expect(session.projects.map((entry) => entry.key)).toEqual(["work/Good"]);
		expect(log.messages).toContainEqual(expect.stringContaining("broken System.json"));
	});

	it("logs folders that can't be searched or have no project", async () => {
		const log = recordingLog();
		const session = new ProjectSession(log, {
			findProjects: async (folder) => {
				if (folder.endsWith("locked")) {
					throw new Error("access denied");
				}
				return [];
			},
			loadProject,
		});
		await session.addFolder({ name: "empty", path: resolve("/empty") });
		await session.addFolder({ name: "locked", path: resolve("/locked") });
		expect(log.messages).toEqual([
			expect.stringMatching(/^No RPG Maker MV project found in /),
			expect.stringMatching(/^Failed to search .* access denied$/),
		]);
	});
});
