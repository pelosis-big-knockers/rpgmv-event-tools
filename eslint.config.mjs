import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["**/dist/", "**/node_modules/", "coverage/"] },
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		languageOptions: { globals: globals.node },
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
	{
		// core must stay usable outside VS Code (CLI, tests, other tools).
		files: ["packages/core/**"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [{ name: "vscode", message: "core must not depend on VS Code." }],
				},
			],
		},
	},
	prettier,
);
