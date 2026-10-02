// Runs the extension smoke test (suite.ts, bundled to out/test/suite.js by the pretest script)
// in a downloaded VS Code with a temporary copy of the basic fixture open, since the tests change
// its files. On Linux without a display, run it under xvfb-run.
import { runTests } from "@vscode/test-electron";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDevelopmentPath = fileURLToPath(new URL("../../", import.meta.url));
const extensionTestsPath = fileURLToPath(new URL("../../out/test/suite.js", import.meta.url));
// A fresh profile, so settings and state from other runs can't change the result.
const userDataDir = mkdtempSync(join(tmpdir(), "rpgmv-smoke-"));
// The copy keeps the fixture's folder name, which names the project in `rpgmv:` URIs.
const workspaceDir = mkdtempSync(join(tmpdir(), "rpgmv-smoke-workspace-"));
const fixture = join(workspaceDir, "basic");
cpSync(fileURLToPath(new URL("../../../core/test/fixtures/basic", import.meta.url)), fixture, {
	recursive: true,
});

try {
	await runTests({
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs: [
			fixture,
			"--disable-extensions",
			"--disable-workspace-trust",
			`--user-data-dir=${userDataDir}`,
		],
	});
} catch (error) {
	console.error("Extension smoke test failed:", error);
	process.exitCode = 1;
} finally {
	rmSync(userDataDir, { recursive: true, force: true });
	rmSync(workspaceDir, { recursive: true, force: true });
}
