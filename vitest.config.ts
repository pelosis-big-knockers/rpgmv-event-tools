import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Test the extension against core's source, as the extension bundle does.
		alias: {
			"@rpgmv-event-tools/core": fileURLToPath(
				new URL("./packages/core/src/index.ts", import.meta.url),
			),
		},
	},
	test: {
		include: ["packages/*/test/**/*.test.ts"],
	},
});
