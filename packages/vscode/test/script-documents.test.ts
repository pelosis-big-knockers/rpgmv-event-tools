import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	REFERENCE_LINE,
	loadProject,
	type ContainerRef,
	type MvProject,
} from "@rpgmv-event-tools/core";
import { beforeAll, describe, expect, it } from "vitest";
import { describeWithGame } from "../../core/test/support/test-game.js";
import { ProjectSession } from "../src/project-session.js";
import {
	ScriptDocuments,
	buildScriptDocument,
	containerPath,
	containerRef,
	findContainer,
	pageStartLine,
} from "../src/script-documents.js";
import { parseScriptPath } from "../src/script-uri.js";

const FIXTURE = fileURLToPath(new URL("../../core/test/fixtures/basic", import.meta.url));

const COMMON_EVENT: ContainerRef = { kind: "commonEvent", commonEventId: 1 };
const MAP_EVENT: ContainerRef = { kind: "mapEvent", mapId: 1, eventId: 1 };
const TROOP: ContainerRef = { kind: "troop", troopId: 1 };

let project: MvProject;
beforeAll(async () => {
	project = await loadProject({ gameDir: FIXTURE, dataDir: join(FIXTURE, "data"), layout: "flat" });
});

describe("findContainer", () => {
	it("finds each kind of container by id", async () => {
		expect(await findContainer(project, COMMON_EVENT)).toMatchObject({
			kind: "commonEvent",
			id: 1,
			commonEvent: { name: "Toggle lantern" },
		});
		expect(await findContainer(project, TROOP)).toMatchObject({
			kind: "troop",
			id: 1,
			troop: { name: "Cellar Bats" },
		});
	});

	it("gives a map event its map's events, so it can name them", async () => {
		const container = await findContainer(project, MAP_EVENT);
		const map = await project.map(1);
		expect(container).toMatchObject({ kind: "mapEvent", mapId: 1, id: 1, event: map.events[1] });
		expect(container?.kind === "mapEvent" && container.mapEvents).toBe(map.events);
	});

	it("finds nothing for missing ids", async () => {
		for (const ref of [
			{ kind: "commonEvent", commonEventId: 99 },
			{ kind: "mapEvent", mapId: 1, eventId: 99 },
			{ kind: "mapEvent", mapId: 99, eventId: 1 }, // not in MapInfos.json
			{ kind: "troop", troopId: 99 },
		] as const) {
			expect(await findContainer(project, ref)).toBeUndefined();
		}
	});
});

describe("buildScriptDocument", () => {
	it("prints one container after the reference line", async () => {
		const container = await findContainer(project, COMMON_EVENT);
		const { text } = buildScriptDocument(project, container!);
		expect(text.split("\n").slice(0, 3)).toEqual([
			REFERENCE_LINE,
			"",
			'defineCommonEvent({ id: 1, name: "Toggle lantern", trigger: "none" }, () => {',
		]);
		expect(text.match(/define\w+\(/g)).toEqual(["defineCommonEvent("]);
	});
});

describe("containerPath and containerRef", () => {
	it("give the document path of a container", async () => {
		const container = (await findContainer(project, MAP_EVENT))!;
		expect(containerRef(container)).toEqual(MAP_EVENT);
		expect(containerPath("basic", container)).toBe("/basic/maps/1/events/1/Keeper.mvscript");
		const troop = (await findContainer(project, TROOP))!;
		expect(containerPath("basic", troop)).toBe("/basic/troops/1/Cellar Bats.mvscript");
	});
});

describe("pageStartLine", () => {
	it("finds the first line of each page", async () => {
		for (const ref of [MAP_EVENT, TROOP]) {
			const { text, sourceMap } = buildScriptDocument(
				project,
				(await findContainer(project, ref))!,
			);
			const lines = text.split("\n");
			const pageLines = lines.flatMap((line, index) => (line.startsWith("\tpage(") ? [index] : []));
			expect(pageLines).toHaveLength(2);
			expect(pageStartLine(sourceMap, ref, 0)).toBe(pageLines[0]);
			expect(pageStartLine(sourceMap, ref, 1)).toBe(pageLines[1]);
			expect(pageStartLine(sourceMap, ref, 2)).toBeUndefined();
		}
	});

	it("finds nothing for another container or a container without pages", async () => {
		const { sourceMap } = buildScriptDocument(project, (await findContainer(project, TROOP))!);
		expect(pageStartLine(sourceMap, { kind: "troop", troopId: 2 }, 0)).toBeUndefined();
		const common = buildScriptDocument(project, (await findContainer(project, COMMON_EVENT))!);
		expect(pageStartLine(common.sourceMap, COMMON_EVENT, 0)).toBeUndefined();
	});
});

describe("ScriptDocuments", () => {
	async function fixtureDocuments(): Promise<ScriptDocuments> {
		const session = new ProjectSession({ info: () => {}, error: () => {} });
		await session.addFolder({ name: "basic", path: FIXTURE });
		return new ScriptDocuments(session);
	}

	it("builds a document once and keeps it until it's forgotten", async () => {
		const documents = await fixtureDocuments();
		const address = { projectKey: "basic", container: TROOP };
		const first = await documents.get(address);
		expect(first.text).toContain('defineTroop({ id: 1, name: "Cellar Bats" }, [');
		expect(await documents.get(address)).toBe(first);
		documents.forget(address);
		const rebuilt = await documents.get(address);
		expect(rebuilt).not.toBe(first);
		expect(rebuilt.text).toBe(first.text);
	});

	it("rejects addresses of missing projects", async () => {
		const documents = await fixtureDocuments();
		await expect(documents.get({ projectKey: "other", container: TROOP })).rejects.toThrow(
			'No RPG Maker MV project "other" is open in the workspace.',
		);
	});

	it("says so in a comment when a container doesn't exist", async () => {
		const documents = await fixtureDocuments();
		const { text, sourceMap } = await documents.get({
			projectKey: "basic",
			container: { kind: "mapEvent", mapId: 1, eventId: 5 },
		});
		expect(text).toBe(`// Event 5 of map 1 doesn't exist in "basic". It may have been deleted.\n`);
		expect(sourceMap.segments).toEqual([]);
	});

	it("forgets the documents whose address passes a test", async () => {
		const documents = await fixtureDocuments();
		const troop = { projectKey: "basic", container: TROOP };
		const common = { projectKey: "basic", container: COMMON_EVENT };
		const [troopDocument, commonDocument] = await Promise.all([
			documents.get(troop),
			documents.get(common),
		]);
		documents.forgetWhere((address) => address.container.kind === "troop");
		expect(await documents.get(troop)).not.toBe(troopDocument);
		expect(await documents.get(common)).toBe(commonDocument);
	});
});

describeWithGame("script documents for the configured test game", (game) => {
	it("builds a document for every container", { timeout: 300_000 }, async () => {
		const project = await loadProject(game);
		const refs: ContainerRef[] = [
			...project.commonEvents.flatMap((event, commonEventId) =>
				event ? [{ kind: "commonEvent" as const, commonEventId }] : [],
			),
			...project.troops.flatMap((troop, troopId) =>
				troop ? [{ kind: "troop" as const, troopId }] : [],
			),
		];
		for (const mapId of project.mapIds()) {
			const map = await project.map(mapId);
			map.events.forEach((event, eventId) => {
				if (event) {
					refs.push({ kind: "mapEvent", mapId, eventId });
				}
			});
		}
		const key = basename(game.gameDir);
		for (const ref of refs) {
			const container = await findContainer(project, ref);
			if (!container) {
				expect.fail(`no container for ${JSON.stringify(ref)}`);
			}
			expect(parseScriptPath(containerPath(key, container))).toEqual({
				projectKey: key,
				container: ref,
			});
			const { text, sourceMap } = buildScriptDocument(project, container);
			expect(text.startsWith(REFERENCE_LINE)).toBe(true);
			const pages =
				container.kind === "mapEvent"
					? container.event.pages
					: container.kind === "troop"
						? container.troop.pages
						: [];
			pages.forEach((_, pageIndex) => {
				expect(pageStartLine(sourceMap, ref, pageIndex), JSON.stringify(ref)).toBeDefined();
			});
		}
	});
});
