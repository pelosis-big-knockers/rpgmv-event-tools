// Runs the extension smoke test (suite.ts, bundled to out/test/suite.js by the pretest script)
// in a downloaded VS Code with the basic fixture open. On Linux without a display, run it under
// xvfb-run.
import { runTests } from "@vscode/test-electron";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDevelopmentPath = fileURLToPath(new URL("../../", import.meta.url));
const extensionTestsPath = fileURLToPath(new URL("../../out/test/suite.js", import.meta.url));
const fixture = fileURLToPath(new URL("../../../core/test/fixtures/basic", import.meta.url));
// A fresh profile, so settings and state from other runs can't change the result.
const userDataDir = mkdtempSync(join(tmpdir(), "rpgmv-smoke-"));

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
}
