/**
 * Script expressions for MV concepts that more than one command uses: the running event, other
 * characters and troop members (see `docs/script-syntax.md`, sections 5.4 and 5.5).
 */
import { computedMember, identifier, member, numberLiteral, type Expr } from "./script-docs.js";

/** The body's parameter for the running event. */
export const EVENT = identifier("event");

/** `troop.members[index]`: a member of the current battle's troop, from 0. */
export function troopMember(index: number): Expr {
	return computedMember(member(identifier("troop"), "members"), numberLiteral(index));
}

/**
 * A character by MV's number: `player` (-1), the running `event` (0), or `map.events[id]`.
 * `useEvent` is called when the running event is used. Returns `undefined` for other numbers.
 */
export function character(id: unknown, useEvent: () => void): Expr | undefined {
	if (id === -1) {
		return identifier("player");
	}
	if (id === 0) {
		useEvent();
		return EVENT;
	}
	return Number.isInteger(id) && (id as number) > 0
		? computedMember(member(identifier("map"), "events"), numberLiteral(id as number))
		: undefined;
}

/** A value's name in a table indexed by value, or `undefined` if it has none. */
export function nameOf(
	names: Readonly<Record<number, string>>,
	value: unknown,
): string | undefined {
	return typeof value === "number" ? names[value] : undefined;
}
