/**
 * Builders for the TypeScript constructs a script is made of. Each returns an {@link Expr}: the
 * layout {@link Doc} Prettier would build for that construct, plus the facts about the syntax node
 * that Prettier's layout decisions depend on (whether a last argument can be "hugged", whether an
 * array is all numbers, and so on). Printed with `printDoc`, scripts come out exactly as Prettier
 * formats them with this repo's settings.
 */
import {
	conditionalGroup,
	fill,
	group,
	hardline,
	ifBreak,
	indent,
	indentIfBreak,
	join,
	line,
	softline,
	breakParent,
	stringWidth,
	willBreak,
	type Doc,
} from "./layout.js";
import { formatStringLiteral } from "./string-literals.js";
import { isIdentifierName } from "./symbols.js";

/** The ESTree node type Prettier would see. */
export type ExprType =
	| "ObjectExpression"
	| "ArrayExpression"
	| "ArrowFunctionExpression"
	| "CallExpression"
	| "MemberExpression"
	| "Identifier"
	| "StringLiteral"
	| "TemplateLiteral"
	| "NumericLiteral"
	| "UnaryExpression"
	| "BooleanLiteral"
	| "NullLiteral"
	| "BinaryExpression"
	| "LogicalExpression";

export interface Expr {
	readonly doc: Doc;
	readonly type: ExprType;
	/** Number of properties or elements, for objects and arrays. */
	readonly size?: number;
	/** A number, possibly negative. */
	readonly numeric?: boolean;
	/** An array of two or more numbers, which Prettier fills rather than breaking per element. */
	readonly concise?: boolean;
	/** An arrow function with a block body. */
	readonly blockBody?: boolean;
	/** A member expression on an identifier chain, such as `switches.Door` or `a.b[1]`. */
	readonly memberChain?: boolean;
}

export function identifier(name: string): Expr {
	return { doc: name, type: "Identifier" };
}

/** A number, written as Prettier normalizes it (`1e21`, not `1e+21`). */
export function numberLiteral(value: number): Expr {
	const text = String(value).replace("e+", "e");
	return value < 0
		? { doc: text, type: "UnaryExpression", numeric: true }
		: { doc: text, type: "NumericLiteral", numeric: true };
}

export function booleanLiteral(value: boolean): Expr {
	return { doc: String(value), type: "BooleanLiteral" };
}

export const nullLiteral: Expr = { doc: "null", type: "NullLiteral" };

/**
 * A script string: raw, with the delimiter picked from the text (see `formatStringLiteral`). To
 * Prettier, a backtick string is a template literal and a split string is a `+` expression.
 */
export function scriptString(text: string): Expr {
	const literal = formatStringLiteral(text);
	if (literal.length !== text.length + 2) {
		return { doc: literal, type: "BinaryExpression" };
	}
	return { doc: literal, type: literal.startsWith("`") ? "TemplateLiteral" : "StringLiteral" };
}

/**
 * A JavaScript string literal with escapes, as used for raw command parameters. Uses the quote
 * Prettier prefers: double, unless the text has more double quotes than single ones.
 */
export function jsString(text: string): Expr {
	return { doc: jsStringText(text), type: "StringLiteral" };
}

function jsStringText(text: string): string {
	const json = JSON.stringify(text);
	const doubles = text.split('"').length - 1;
	const singles = text.split("'").length - 1;
	if (doubles <= singles) {
		return json;
	}
	const inner = json
		.slice(1, -1)
		.replace(/\\(.)|'/g, (match, escaped: string | undefined) =>
			escaped === undefined ? "\\'" : escaped === '"' ? '"' : match,
		);
	return `'${inner}'`;
}

/** Any JSON value as a literal: how raw command parameters are printed. */
export function jsonLiteral(value: unknown): Expr {
	if (value === null || value === undefined) {
		return nullLiteral;
	}
	switch (typeof value) {
		case "boolean":
			return booleanLiteral(value);
		case "number":
			return numberLiteral(value);
		case "string":
			return jsString(value);
		case "object":
			return Array.isArray(value)
				? arrayLiteral(value.map(jsonLiteral))
				: objectLiteral(
						Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
							key,
							jsonLiteral(entry),
						]),
					);
		default:
			return nullLiteral;
	}
}

/** `object.property`, or `object[key]` for a computed key. */
export function member(object: Expr, property: string): Expr {
	return {
		doc: [object.doc, ".", property],
		type: "MemberExpression",
		memberChain: object.type === "Identifier" || object.memberChain === true,
	};
}

/** A reference the symbol table already formatted, such as `switches["Light on"]`. */
export function reference(text: string): Expr {
	return { doc: text, type: "MemberExpression", memberChain: true };
}

/** An object literal. Keys are quoted only when they aren't identifiers, as Prettier does. */
export function objectLiteral(properties: readonly (readonly [key: string, value: Expr])[]): Expr {
	if (properties.length === 0) {
		return { doc: "{}", type: "ObjectExpression", size: 0 };
	}
	const printed = properties.map(([key, value]) => property(key, value));
	return {
		doc: group(["{", indent([line, join([",", line], printed)]), ifBreak(","), line, "}"]),
		type: "ObjectExpression",
		size: properties.length,
	};
}

/** Prettier's assignment layouts, as they apply to object properties. */
function property(key: string, value: Expr): Doc {
	const keyDoc = isIdentifierName(key) ? key : jsStringText(key);
	const shortKey = stringWidth(keyDoc) < 2 + 3;
	const binaryish = value.type === "BinaryExpression" || value.type === "LogicalExpression";
	if (binaryish || (!shortKey && (value.type === "StringLiteral" || value.memberChain))) {
		return group([keyDoc, ":", group(indent([line, value.doc]))]);
	}
	if (shortKey || value.type === "TemplateLiteral") {
		return group([keyDoc, ": ", value.doc]);
	}
	const id = Symbol("assignment");
	return group([keyDoc, ":", group(indent(line), { id }), indentIfBreak(value.doc, id)]);
}

/** An array literal. Arrays of numbers fill lines; others put each element on its own line. */
export function arrayLiteral(elements: readonly Expr[]): Expr {
	if (elements.length === 0) {
		return { doc: "[]", type: "ArrayExpression", size: 0 };
	}
	const concise = elements.length > 1 && elements.every((element) => element.numeric);
	const shouldBreak =
		elements.length > 1 &&
		elements.every(
			(element, index) =>
				(element.type === "ObjectExpression" || element.type === "ArrayExpression") &&
				(element.size ?? 0) > 1 &&
				(elements[index + 1] === undefined || elements[index + 1]?.type === element.type),
		);
	const id = Symbol("array");
	const items: Doc = concise
		? fill(
				elements.flatMap((element, index) =>
					index === elements.length - 1
						? [[element.doc, ifBreak(",", "", id)]]
						: [[element.doc, ","], line],
				),
			)
		: [
				join(
					[",", line],
					elements.map((element) => group(element.doc)),
				),
				ifBreak(","),
			];
	return {
		doc: group(["[", indent([softline, items]), softline, "]"], { shouldBreak, id }),
		type: "ArrayExpression",
		size: elements.length,
		concise,
	};
}

/** A call, laid out by Prettier's rules for call arguments, including "hugging" the last one. */
export function call(callee: Doc, args: readonly Expr[]): Expr {
	return { doc: [callee, callArguments(args)], type: "CallExpression" };
}

function callArguments(args: readonly Expr[]): Doc {
	if (args.length === 0) {
		return "()";
	}
	const printed: Doc[] = args.map((arg, index) =>
		index === args.length - 1 ? arg.doc : [arg.doc, ",", line],
	);
	const allArgsBrokenOut = () =>
		group(["(", indent([line, ...printed, ","]), line, ")"], { shouldBreak: true });

	if (shouldGroupLast(args)) {
		const leading = printed.slice(0, -1);
		if (leading.some(willBreak)) {
			return allArgsBrokenOut();
		}
		const last = printed.at(-1) as Doc;
		return [
			printed.some(willBreak) ? breakParent : "",
			conditionalGroup([
				["(", ...leading, last, ")"],
				["(", ...leading, group(last, { shouldBreak: true }), ")"],
				allArgsBrokenOut(),
			]),
		];
	}
	return group(["(", indent([softline, ...printed]), ifBreak(","), softline, ")"], {
		shouldBreak: printed.some(willBreak),
	});
}

function shouldGroupLast(args: readonly Expr[]): boolean {
	const last = args.at(-1) as Expr;
	const penultimate = args.at(-2);
	const couldExpand =
		((last.type === "ObjectExpression" || last.type === "ArrayExpression") &&
			(last.size ?? 0) > 0) ||
		(last.type === "ArrowFunctionExpression" && last.blockBody === true);
	return (
		couldExpand &&
		(penultimate === undefined || penultimate.type !== last.type) &&
		!(
			args.length === 2 &&
			penultimate?.type === "ArrowFunctionExpression" &&
			last.type === "ArrayExpression"
		) &&
		!(args.length > 1 && last.concise === true)
	);
}

/**
 * An arrow function with a block body. `beforeClose` is printed just before the closing brace
 * (for source-map marks).
 */
export function arrowBlock(
	parameters: readonly string[],
	statements: readonly Doc[],
	beforeClose: Doc = "",
): Expr {
	const body: Doc =
		statements.length === 0
			? ["{", beforeClose, "}"]
			: ["{", indent([hardline, join(hardline, statements)]), hardline, beforeClose, "}"];
	return {
		doc: group([`(${parameters.join(", ")})`, " =>", " ", body]),
		type: "ArrowFunctionExpression",
		blockBody: true,
	};
}

/** An arrow function returning an expression. */
export function arrowExpression(parameters: readonly string[], body: Expr): Expr {
	const sameLine = body.type === "ObjectExpression" || body.type === "ArrayExpression";
	return {
		doc: group([
			`(${parameters.join(", ")})`,
			" =>",
			sameLine ? [" ", body.doc] : group(indent([line, body.doc])),
		]),
		type: "ArrowFunctionExpression",
	};
}

/** A comparison such as `variables.Day >= 3`. */
export function binary(left: Expr, operator: string, right: Expr): Expr {
	return {
		doc: group([left.doc, " ", group([operator, line, right.doc])]),
		type: "BinaryExpression",
	};
}

/** `a && b && c`, as the body of an arrow function. */
export function and(operands: readonly Expr[]): Expr {
	const [first, ...rest] = operands;
	if (first === undefined) {
		throw new Error("and() needs at least one operand");
	}
	if (rest.length === 0) {
		return first;
	}
	const parts: Doc[] = [first.doc];
	for (const operand of rest) {
		const right: Doc = ["&&", line, operand.doc];
		// Prettier groups the right side only in a chain of two whose operands aren't chains.
		parts.push(" ", operands.length === 2 ? group(right) : right);
	}
	return { doc: group(parts), type: "LogicalExpression" };
}

/** An expression statement. */
export function statement(expression: Expr): Doc {
	return [expression.doc, ";"];
}
