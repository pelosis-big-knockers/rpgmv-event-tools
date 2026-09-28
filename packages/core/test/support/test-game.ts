import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { resolveMvProject, type MvProjectLocation } from "../../src/index.js";

/**
 * Locates a local RPG Maker MV game for tests that need real data. Game data is never
 * committed, so these tests are skipped unless a game is configured through either:
 *
 * - the `RPGMV_TEST_GAME` environment variable, or
 * - `gamePath` in a gitignored `test-data.local.json` at the repo root
 *   (see `test-data.local.example.json`).
 *
 * Relative paths are resolved against the repo root.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LOCAL_CONFIG = resolve(REPO_ROOT, "test-data.local.json");
const SETUP_HINT = "set RPGMV_TEST_GAME or create test-data.local.json to run";

type TestGame =
	| { status: "found"; game: MvProjectLocation }
	| { status: "unconfigured" }
	| { status: "invalid"; reason: string };

function configuredPath(): { path: string; source: string } | undefined {
	const fromEnv = process.env["RPGMV_TEST_GAME"]?.trim();
	if (fromEnv) {
		return { path: fromEnv, source: "RPGMV_TEST_GAME" };
	}
	if (existsSync(LOCAL_CONFIG)) {
		const config = JSON.parse(readFileSync(LOCAL_CONFIG, "utf8")) as { gamePath?: unknown };
		if (typeof config.gamePath === "string" && config.gamePath.trim()) {
			return { path: config.gamePath.trim(), source: "test-data.local.json" };
		}
	}
	return undefined;
}

async function locateTestGame(): Promise<TestGame> {
	const configured = configuredPath();
	if (!configured) {
		return { status: "unconfigured" };
	}
	const path = resolve(REPO_ROOT, configured.path);
	if (!existsSync(path)) {
		return { status: "invalid", reason: `${configured.source} path does not exist: ${path}` };
	}
	const game = await resolveMvProject(path);
	if (!game) {
		return {
			status: "invalid",
			reason: `no data/System.json or www/data/System.json under ${configured.source} path: ${path}`,
		};
	}
	return { status: "found", game };
}

const testGame = await locateTestGame();

/**
 * Like `describe`, but gives the suite the configured test game. When no game is configured,
 * or the configured path is not an MV game, the suite is skipped and its title says why.
 */
export function describeWithGame(name: string, suite: (game: MvProjectLocation) => void): void {
	switch (testGame.status) {
		case "found":
			describe(name, () => suite(testGame.game));
			break;
		case "unconfigured":
			skipSuite(name, `no test game: ${SETUP_HINT}`);
			break;
		case "invalid":
			skipSuite(name, `invalid test game: ${testGame.reason}`);
			break;
	}
}

// The suite body is not run when skipping (it would need a real game), so register a single
// placeholder test to keep the skip visible in the report.
function skipSuite(name: string, reason: string): void {
	describe.skip(`${name} (${reason})`, () => {
		it("requires a test game", () => {});
	});
}
