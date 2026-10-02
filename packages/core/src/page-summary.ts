/**
 * Short descriptions of map event and troop pages, for places that list pages without their
 * commands, such as the explorer's tree. They print the page's options with the decompiler, so
 * they use the script's names.
 */
import { pageOptions, type DecompileContext, type ScriptPage } from "./decompile.js";
import { printDoc } from "./layout.js";
import { objectLiteral, type Expr } from "./script-docs.js";
import { parseStringLiteral } from "./string-literals.js";

export interface PageSummary {
	/**
	 * The options object of the page's `page(…)` call, printed as the script prints it, for
	 * example `{ trigger: "action", when: () => switches.Door_open }`. Long options break over
	 * several lines, indented with tabs.
	 */
	readonly options: string;
	/**
	 * One line: the trigger or span, then each check of `when`, joined with ` · `, for example
	 * `action · switches.Door_open` or `turn · troop.turn(2)`. Conditions `when` can't express
	 * show as `conditions`.
	 */
	readonly summary: string;
}

/** Prints a page's options and a one-line summary of them. */
export function summarizePage(page: ScriptPage, context: DecompileContext): PageSummary {
	const { options, checks } = pageOptions(page, context);
	const [, mode] = options[0]!;
	const parts = [enumName(mode), ...(checks ? checks.map(printFlat) : ["conditions"])];
	return {
		options: printDoc(objectLiteral(options).doc),
		summary: parts.join(" · "),
	};
}

/** A trigger or span's name without quotes, or its stored value when it has none. */
function enumName(value: Expr): string {
	const printed = printFlat(value);
	const parsed = parseStringLiteral(printed);
	return parsed?.ok && parsed.end === printed.length ? parsed.value : printed;
}

/** An expression on one line. */
function printFlat(expr: Expr): string {
	return printDoc(expr.doc, { printWidth: Infinity, tabWidth: 2 });
}
