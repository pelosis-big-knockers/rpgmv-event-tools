/**
 * The JavaScript in event data: Script commands (`355` + `655`), script conditions (`111`),
 * script operands (`122`) and the move-route step `script` (code 45). The script prints this code
 * as a lambda that keeps it exactly as stored (spec 8.2): an expression body,
 * `script(() => code)`, or a block body with one stored line per line.
 *
 * These checks decide which form keeps the code exactly. Each parses the code with acorn, then
 * parses the lambda as it would be printed and checks that its body reads back as exactly the
 * stored text.
 */
import { parse, type ArrowFunctionExpression, type Options, type Program } from "acorn";

const PARSE_OPTIONS: Options = {
	ecmaVersion: "latest",
	sourceType: "script",
	// Keep parentheses as nodes, so `(a)` covers its parentheses too.
	preserveParens: true,
};

/**
 * JavaScript's line terminators. A stored line can't contain one: each stored line is one line
 * of the script.
 */
const LINE_TERMINATOR = /[\r\n\p{Zl}\p{Zp}]/u;

/** How the call around a lambda starts, in the checks' canonical printing. */
const CALL_START = "script(() => ";

/**
 * Whether `code` prints as an expression body, `script(() => code)`: it is one line holding one
 * expression and nothing else (no `;`, and no whitespace or comments around it), and the printed
 * lambda's body is exactly `code`. That rules out an object literal without parentheses (it
 * would read as a block), a sequence `a, b` (it would read as two arguments) and a trailing line
 * comment (it would swallow the `)`).
 */
export function isExpressionBody(code: string): boolean {
	if (LINE_TERMINATOR.test(code)) {
		return false;
	}
	const statement = onlyStatement(parseScript(code));
	if (statement?.type !== "ExpressionStatement" || statement.start !== 0) {
		return false;
	}
	if (statement.end !== code.length || statement.expression.end !== code.length) {
		return false;
	}
	const arrow = lambdaIn(parseScript(`${CALL_START}${code})`));
	return (
		arrow?.expression === true &&
		arrow.body.start === CALL_START.length &&
		arrow.body.end === CALL_START.length + code.length
	);
}

/**
 * Whether the stored `lines` print as a block body: `script(() => {`, then each line after the
 * block's indentation (an empty line stays empty), then `});`. The code must parse, and the
 * printed block must read back as exactly these lines, which a template literal spanning lines
 * still does (the compiler removes the indentation again).
 */
export function isBlockBody(lines: readonly string[]): boolean {
	if (lines.some((text) => LINE_TERMINATOR.test(text)) || !parseScript(lines.join("\n"))) {
		return false;
	}
	const body = lines.map((text) => (text === "" ? text : `\t${text}`)).join("\n");
	const source = `${CALL_START}{\n${body}\n});`;
	const arrow = lambdaIn(parseScript(source));
	return (
		arrow?.body.type === "BlockStatement" &&
		arrow.body.start === CALL_START.length &&
		arrow.body.end === source.length - ");".length
	);
}

function parseScript(source: string): Program | undefined {
	try {
		return parse(source, PARSE_OPTIONS);
	} catch {
		return undefined;
	}
}

function onlyStatement(program: Program | undefined): Program["body"][number] | undefined {
	return program?.body.length === 1 ? program.body[0] : undefined;
}

/** The lambda of a program that is exactly one statement, `script(() => …)`. */
function lambdaIn(program: Program | undefined): ArrowFunctionExpression | undefined {
	const statement = onlyStatement(program);
	if (statement?.type !== "ExpressionStatement") {
		return undefined;
	}
	const call = statement.expression;
	if (
		call.type !== "CallExpression" ||
		call.callee.type !== "Identifier" ||
		call.callee.name !== "script" ||
		call.arguments.length !== 1
	) {
		return undefined;
	}
	const [arrow] = call.arguments;
	return arrow?.type === "ArrowFunctionExpression" && arrow.params.length === 0 && !arrow.async
		? arrow
		: undefined;
}
