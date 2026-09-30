import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	decompileDocument,
	loadProject,
	resolveMvProject,
	type EventCommand,
	type MvProject,
	type ScriptContainer,
} from "../../core/src/index.js";
import { checkDocument, expectedCodes, highlightedCodes } from "./support/grammar-checks.js";
import { tokenizeDocument } from "./support/textmate.js";

/**
 * The grammar's snapshot tests (`npm run test:grammar`) tokenize the samples in `test/syntax`.
 * Most samples are printed here by the decompiler, so they stay what it really prints; this file
 * checks they are up to date (`vitest -u` rewrites them). `rules.mvscript` is hand-written.
 */

const FIXTURE = fileURLToPath(new URL("../../core/test/fixtures/basic", import.meta.url));
const sample = (name: string) => fileURLToPath(new URL(`./syntax/${name}`, import.meta.url));

const cmd = (code: number, indent: number, parameters: unknown[] = []): EventCommand => ({
	code,
	indent,
	parameters,
});
const step = (code: number, parameters: unknown[]) => ({ code, parameters, indent: null });

/** Invented commands for each rule of the grammar, as one common event. */
function grammarCases(): ScriptContainer {
	const route = [
		step(45, ["this.setOpacity(128)"]),
		step(45, ['this._name = "Mira \\"the\\" guard"']),
		step(45, ["this.jump(0, 0);"]),
	];
	const long = `$gameVariables.value(${"1".repeat(40)}) + $gameVariables.value(${"2".repeat(40)})`;
	const list = [
		cmd(101, 0, ["", 0, 0, 2]),
		cmd(401, 0, ["\\C[2]Mira\\C[0]: The gate costs 50\\G. You have \\V[1]."]),
		cmd(401, 0, ["\\{Wait!\\} \\.\\.\\. \\!Did you hear that?\\|"]),
		cmd(401, 0, ["The key is in C:\\"]),
		cmd(101, 0, ["", 0, 0, 2]),
		cmd(401, 0, ['She said "hi".']),
		cmd(401, 0, [`"It's late," he said.`]),
		cmd(401, 0, ["All three: \"'` and more"]),
		cmd(101, 0, ["", 0, 0, 2]),
		cmd(401, 0, ["\\fs[20]Plugin codes\\fs[0], a stray \\ backslash and \\\\ one."]),
		cmd(108, 0, ["A comment keeps \\C[2] as is"]),
		cmd(408, 0, ['and "quotes" too']),
		cmd(355, 0, ["var name = $gameActors.actor(1).name();"]),
		cmd(655, 0, ["$gameMessage.add('Hello, ' + name);"]),
		cmd(655, 0, ['$gameVariables.setValue(2, name.length + "!".length);']),
		cmd(655, 0, ['if (name.endsWith(\'\\\\\')) { $gameMessage.add("It\'s a \\"path\\""); }']),
		cmd(655, 0, [""]),
		cmd(655, 0, ["var text = `\\C[2]one"]),
		cmd(655, 0, ["  two ${name})`; // (done"]),
		cmd(355, 0, ["$gameSystem.disableSave()"]),
		cmd(355, 0, [long]),
		cmd(355, 0, ["$gameMessage.add('\\\\C[2]Not a text code');"]),
		cmd(355, 0, ["if ("]),
		cmd(111, 0, [12, "$gameParty.size() > 2"]),
		cmd(122, 1, [2, 2, 0, 4, "Math.floor(Math.random() * 3)"]),
		cmd(0, 1),
		cmd(412, 0),
		cmd(111, 0, [12, "Input.isPressed('ok');"]),
		cmd(0, 1),
		cmd(412, 0),
		cmd(111, 0, [12, `${long} > 0`]),
		cmd(0, 1),
		cmd(412, 0),
		cmd(111, 0, [12, `${long} > 0 && "\\C[2]";`]),
		cmd(0, 1),
		cmd(412, 0),
		cmd(205, 0, [
			-1,
			{ list: [...route, { code: 0 }], repeat: false, skippable: true, wait: true },
		]),
		...route.map((entry) => cmd(505, 0, [entry])),
		cmd(356, 0, ["Lighting on 3"]),
		cmd(356, 0, ["script run \\C[2]"]),
		cmd(999, 0, ['\\c[2]Raw "text"', 1]),
		cmd(0, 0),
	];
	return {
		kind: "commonEvent",
		id: 1,
		commonEvent: { id: 1, name: "Grammar cases", trigger: 0, switchId: 1, list },
	};
}

async function fixtureDocuments(project: MvProject): Promise<Record<string, string>> {
	const context = { symbols: project.symbols };
	const map = await project.map(1);
	const commonEvents = project.commonEvents.flatMap((event, id) =>
		event ? [{ kind: "commonEvent" as const, id, commonEvent: event }] : [],
	);
	const mapEvents = map.events.flatMap((event, id) =>
		event ? [{ kind: "mapEvent" as const, mapId: 1, id, event, mapEvents: map.events }] : [],
	);
	const troops = project.troops.flatMap((troop, id) =>
		troop ? [{ kind: "troop" as const, id, troop }] : [],
	);
	return {
		"fixture-common-events.mvscript": decompileDocument(commonEvents, context).text,
		"fixture-map.mvscript": decompileDocument(mapEvents, context).text,
		"fixture-troops.mvscript": decompileDocument(troops, context).text,
		"grammar-cases.mvscript": decompileDocument([grammarCases()], context).text,
	};
}

describe("grammar samples", async () => {
	const location = await resolveMvProject(FIXTURE);
	const documents = await fixtureDocuments(await loadProject(location!));

	for (const [name, text] of Object.entries(documents)) {
		it(`${name} is the decompiler's output`, async () => {
			await expect(text).toMatchFileSnapshot(sample(name));
		});
	}

	for (const name of [...Object.keys(documents), "rules.mvscript"]) {
		it(`${name} has a token snapshot`, () => {
			// vscode-tmgrammar-snap writes a missing snapshot and passes, so check it here.
			expect(existsSync(`${sample(name)}.snap`)).toBe(true);
		});

		it(`${name} reads every string as the script does`, async () => {
			const text = readFileSync(sample(name), "utf8");
			// rules.mvscript ends with an unterminated string on purpose.
			const problems = checkDocument(await tokenizeDocument(text));
			expect(problems).toEqual(
				name === "rules.mvscript" ? [expect.stringMatching(/doesn't close$/)] : [],
			);
		});
	}
});

describe("text codes", () => {
	/** Highlights `text` (which has no `"`) as a Show Text string and returns the codes found. */
	async function highlight(text: string) {
		const [line] = await tokenizeDocument(`showText("${text}");`);
		// Leave out `showText`, `(` and the quotes, `)` and `;`.
		return highlightedCodes(line!.slice(3, -3));
	}

	it("are the codes tokenizeText finds", async () => {
		const cases = [
			"\\C[2]Mira\\C[0] has \\V[12] \\G, or \\Gold: \\N[1], \\n[1], \\P[1], \\I[64], \\v[03].",
			"\\{Big\\} \\. \\| \\! \\> fast \\< \\^ \\$ \\\\ literal",
			"Plugin \\fs[20] \\msgposx[a] \\C[x] \\C \\Cx[2] \\V[] \\# \\_ \\~ \\[",
			"Stray \\1 \\ space, \\\\\\V[1], \\C[2\\] and at the end \\",
		];
		for (const text of cases) {
			expect(await highlight(text), text).toEqual(expectedCodes(text));
		}
	});

	it("agree with tokenizeText on random text", async () => {
		// A small xorshift generator, so the cases are the same on every run.
		let seed = 0x2f6b1d3;
		const next = (n: number) => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return (seed >>> 0) % n;
		};
		const alphabet = ["\\", "\\", "\\", "V", "v", "c", "G", "g", "x", "[", "]", "1", "0"];
		alphabet.push("{", "}", ".", "|", "!", "<", ">", "^", "$", "#", " ", "'", "`");
		for (let i = 0; i < 2000; i++) {
			const length = 1 + next(12);
			const text = Array.from({ length }, () => alphabet[next(alphabet.length)]).join("");
			expect(await highlight(text), text).toEqual(expectedCodes(text));
		}
	});
});
