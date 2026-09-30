import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { IGrammar } from "vscode-textmate";

/**
 * Loads the script grammar the way VS Code does, with the TypeScript and JavaScript grammars it
 * builds on (vendored in `test/grammars`, see the README there).
 */

const require = createRequire(import.meta.url);
// Both packages are UMD bundles, which Node's ESM loader can't see named exports in.
const oniguruma = require("vscode-oniguruma") as typeof import("vscode-oniguruma");
const textmate = require("vscode-textmate") as typeof import("vscode-textmate");

const GRAMMAR_FILES: Record<string, URL> = {
	"source.rpgmv-script": new URL("../../syntaxes/rpgmv-script.tmLanguage.json", import.meta.url),
	"source.ts": new URL("../grammars/TypeScript.tmLanguage.json", import.meta.url),
	"source.js": new URL("../grammars/JavaScript.tmLanguage.json", import.meta.url),
};

/** One token of a line: its text and its scopes, outermost first. */
export interface Token {
	text: string;
	scopes: string[];
}

async function createGrammar(): Promise<IGrammar> {
	const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
	await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
	const registry = new textmate.Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
			createOnigString: (text) => new oniguruma.OnigString(text),
		}),
		loadGrammar: async (scopeName) => {
			const file = GRAMMAR_FILES[scopeName];
			if (!file) {
				return null;
			}
			const path = fileURLToPath(file);
			return textmate.parseRawGrammar(readFileSync(path, "utf8"), path);
		},
	});
	const grammar = await registry.loadGrammar("source.rpgmv-script");
	if (!grammar) {
		throw new Error("The script grammar did not load.");
	}
	return grammar;
}

let grammar: Promise<IGrammar> | undefined;

/** Tokenizes a document, returning the tokens of each line. */
export async function tokenizeDocument(text: string): Promise<Token[][]> {
	grammar ??= createGrammar();
	const loaded = await grammar;
	let state = textmate.INITIAL;
	return text.split(/\r?\n/).map((line) => {
		const result = loaded.tokenizeLine(line, state);
		state = result.ruleStack;
		return result.tokens.map((token) => ({
			text: line.slice(token.startIndex, token.endIndex),
			scopes: token.scopes,
		}));
	});
}
