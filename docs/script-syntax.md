# Script syntax

This is the spec for the **script**: the readable text that the decompiler prints for an RPG
Maker MV event, and that the compiler (#6) parses back into MV's JSON. It is part of the
decompiler epic (#3).

Sections marked **Outline** list the intended syntax for a group of commands. The PR that
implements the group (#41–#44) finalizes its section, and may change details when real data
calls for it. Everything else here is settled.

Contents:

1. [Overview](#1-overview)
2. [MV concepts in brief](#2-mv-concepts-in-brief)
3. [Principles](#3-principles)
4. [Lexical rules](#4-lexical-rules)
5. [Names and references](#5-names-and-references)
6. [Containers and pages](#6-containers-and-pages)
7. [Statements](#7-statements)
8. [Commands by group](#8-commands-by-group)
9. [Data the script leaves out](#9-data-the-script-leaves-out)
10. [Worked examples](#10-worked-examples)
11. [Open questions](#11-open-questions)

## 1. Overview

An MV event is a list of numbered commands (`101` Show Text, `111` Conditional Branch, …) with
an `indent` on each one. The script prints that list as TypeScript-flavored code:

```ts
@commonEvent({ id: 3, trigger: "none" })
function Light_lantern() {
	if (switches.Lantern_lit) {
		showText("The lantern is already lit.");
	} else {
		switches.Lantern_lit = true;
		playSe("Fire1");
		showText("You light the lantern.");
	}
}
```

It looks like TypeScript, but it is its own language with its own parser (#6). It stays close
enough to TypeScript that a valid-TS copy can be generated mechanically, for example to run the TS
language service over it (spike #45). Where the script has constructs that TypeScript doesn't,
this spec says so.

## 2. MV concepts in brief

Short background for readers new to RPG Maker MV. The terms here are used throughout.

- **Event command**: one step of event logic, `{ code, indent, parameters }`. The code says what
  it does (see the catalog in `packages/core/src/commands.ts`).
- **Command list**: the commands of a common event or a page, in order. Blocks (branches, loops,
  choices) are not nested objects. They are flat runs of commands, marked by `indent` and by
  extra commands that open branches (`411` Else) and close blocks (`412` End). Every list, and
  every branch body, ends with a code `0` command.
- **Common event**: a reusable command list in `CommonEvents.json`. Other events call it (`117`),
  or it runs by itself while a switch is ON: **autorun** (the player can't move until it stops)
  or **parallel** (runs alongside play).
- **Map event**: an object placed on a map (`MapXXX.json`) at a tile position, such as a person,
  a door or a treasure chest. It has one or more **pages**.
- **Page**: one version of a map event, with its own conditions, trigger, graphic, movement and
  command list. MV uses the **highest-numbered page whose conditions all hold**. If none hold,
  the event is absent. A page with no conditions always holds.
- **Trigger**: what starts a page: the action button, the player touching the event, the event
  touching the player, autorun, or parallel.
- **Troop**: a group of enemies for a battle (`Troops.json`). Its pages are battle events. A
  troop page with no conditions **never** runs. The page's **span** says how often it may run:
  once per battle, once per turn, or every moment its conditions hold.
- **Switch**: a global, numbered ON/OFF flag, named in `System.json`. Switch 12 is the same flag
  everywhere in the game.
- **Variable**: a global, numbered value, usually an integer.
- **Self switch**: four ON/OFF flags, `A` to `D`, that belong to one map event. Self switch `A`
  of event 7 on map 3 is unrelated to `A` of any other event. They typically record "this chest
  is open" without spending a global switch. A common event uses the self switches of the event
  that called it.
- **Database**: numbered entries in `Actors.json`, `Items.json` and so on. Commands refer to them
  by id. Entry 0 is always unused.
- **Text code**: a backslash sequence inside message text, such as `\c[2]` (text color 2) or
  `\N[1]` (the name of actor 1). See [4.5](#45-text-codes).
- **Plugin command**: command `356`, one line of text (`Head arg1 arg2`) that a JavaScript plugin
  interprets.
- **Comment**: command `108` (plus a `408` for each further line). The engine ignores it, but
  some plugins read tags from it, so comments are data.

## 3. Principles

1. **Lossless.** Decompiling and then compiling gives back byte-identical JSON. The printer uses a
   construct only when compiling it reproduces the exact command, including parameter types
   (`true` vs `1`) and parameter counts. Otherwise that command prints with the
   [raw fallback](#74-raw-fallback). So partial or unusual data never loses information.
2. **Ids are authoritative.** Names are for reading. Every reference also has an id form, and the
   compiler always accepts it.
3. **Derived data is left out.** Anything the compiler can regenerate from the rest (block ends,
   `0` terminators, copies of choice texts, …) is not printed. See [section 9](#9-data-the-script-leaves-out).
4. **The script is a view of the event logic, not the whole file.** Data the script doesn't show
   (a page's graphic and movement settings, a troop's enemy positions, the ids stored in unused
   page-condition slots) is kept from the existing file when compiling. New pages and containers
   get the MV editor's defaults.
5. **Defaults are left out.** Options that have the value the MV editor gives a new command are
   not printed.
6. **Text stays exactly as written.** Strings have no escape sequences, so MV text codes and
   backslashes appear in the script exactly as MV stores them.

## 4. Lexical rules

### 4.1 Source text and whitespace

- Source is Unicode text. The printer writes `\n` line ends; the parser also accepts `\r\n`.
- **Indentation**: the printer indents with **one tab per level**, like this repo's code. Tabs
  keep deep nesting readable (the test game nests up to 134 levels), and each reader can pick a
  tab width. The parser ignores indentation: blocks are delimited by braces.
- Blank lines are not significant, with one exception: a blank line separates two adjacent
  comments (see [7.3](#73-comments)). The printer puts blank lines only there, between pages and
  between containers.
- Statements end with `;`. Blocks (`{ … }`) don't.

### 4.2 Identifiers and reserved words

An **identifier** matches this regular expression, with the `u` flag:

```
^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$
```

This is the ECMAScript rule, so identifiers may contain non-ASCII letters
(`switches.Tür`).

**Reserved words** can't be used as a function or class name (see [6.1](#61-names-of-functions-and-classes)).
They are allowed after a dot, as in TypeScript: `switches.if` is fine.

- ECMAScript reserved words, including strict mode's:

  ```
  await break case catch class const continue debugger default delete do else enum export
  extends false finally for function if implements import in instanceof interface let new null
  package private protected public return static super switch this throw true try typeof var
  void while with yield
  ```

- Other names that would break a generated TS copy: `arguments`, `eval`, `undefined`, `NaN`,
  `Infinity`.
- The script's own global names:
  - every collection in [5.1](#51-collections)
  - `selfSwitches`, `events`, `player`, `thisEvent`, `party`, `members`, `timer`, `game`, `input`,
    `plugin`, `command`, `comment`, `script`, `random`
  - every command call name in [section 8](#8-commands-by-group) (the printer takes them from its
    renderer registry, #40)

### 4.3 Numbers

A number is a decimal literal: `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`. The printer
writes `String(n)` for a number `n`, so every printed number reads back as the same value.
`NaN`, `Infinity` and `-0` never print as numbers (where they appear, the command uses the raw
fallback).

### 4.4 String literals

Strings are **raw**: there are **no escape sequences**. Every character between the delimiters
is part of the string, backslashes included. MV text like `\c[2]Hello\c[0]` is written exactly
so.

The printer picks the delimiter from the text:

| The text contains           | Delimiter                                               | Example                       |
| --------------------------- | ------------------------------------------------------- | ----------------------------- |
| no `"`                      | `"`                                                     | `"Hello."`                    |
| `"` but no `'`              | `'`                                                     | `'She said "hi".'`            |
| both `"` and `'`            | `` ` ``                                                 | `` `"It's late," he said.` `` |
| all of `"`, `'` and `` ` `` | pieces joined with `+`, each piece following this table | `` `"It's` + "`" ``           |

- A backtick string is **not** a template literal: `${` has no meaning inside it.
- A string can't contain a line break. No string in the test game does (text lines are separate
  commands). A command with such a string uses the raw fallback.
- `+` is only allowed between string literals, and only joins them.
- The parser accepts any of the three delimiters for any string that doesn't contain it.
- #38 implements this rule as `formatStringLiteral` (`packages/core/src/string-literals.ts`).

**Rationale.** An earlier draft used `"` strings with `\"` as the only escape. That breaks for
text that ends with a backslash: `"Wait...\"` can't tell a closing quote from an escaped one, so
`\\` would need to be an escape too, and then MV's own `\\` (a literal backslash) would no longer
appear as written. Raw strings avoid escaping entirely. The data supports it: in the test game,
32,391 text lines contain `"`, 8,358 contain both `"` and `'`, none contain a backtick, 227 end
with a backslash, and none contain a line break. So `'` and `` ` `` cover every line, and the `+`
split is only a safety net. The cost is that TypeScript tools read `\"` differently: syntax
highlighting uses our own grammar (#4), and the valid-TS copy (#45) re-escapes strings.

### 4.5 Text codes

A **text code** is a backslash sequence in message text that the game's message window
interprets. The script keeps codes exactly as written (case and leading zeros included: `\N[1]`
and `\n[1]` are the same code, `\v[03]` is variable 3), and editor hovers and inlay hints (#4,
#5) explain them. Note that `\n` is never a line break: `\n[1]` is the name of actor 1.

The core engine's codes (`Window_Base` and `Window_Message` in `rpg_windows.js`):

| Code      | Meaning                                                               |
| --------- | --------------------------------------------------------------------- |
| `\V[n]`   | Value of variable `n`                                                 |
| `\N[n]`   | Name of actor `n`                                                     |
| `\P[n]`   | Name of party member `n` (1 is the leader)                            |
| `\G`      | Currency unit (even when letters follow: `\Gold` is the unit + `old`) |
| `\C[n]`   | Text color `n` from the window skin (0 is normal)                     |
| `\I[n]`   | Icon `n`                                                              |
| `\{` `\}` | Text 12 pixels bigger / smaller                                       |
| `\\`      | A literal backslash                                                   |
| `\$`      | Open the gold window (Show Text only)                                 |
| `\.`      | Wait 15 frames, a quarter second (Show Text only)                     |
| `\!`      | Wait for a button press (Show Text only)                              |
| `\>` `\<` | Show the rest of the line at once / stop doing so (Show Text only)    |
| `\^`      | Close the message without waiting for input (Show Text only)          |

One more is left out of the table because of its pipe character: `\|` waits 60 frames, one
second (Show Text only).

Letters are case-insensitive. Plugins add their own codes (`\fs[20]`, …); these are recognized
by shape, a backslash followed by letters with an optional `[…]` argument, or by one symbol. A
backslash followed by anything else (a digit, a space, the end of the text) starts no code, and
the game skips it.

`tokenizeText` in `packages/core/src/text-codes.ts` splits a string into plain text and codes,
tagging each code with its kind. It is lossless (the tokens join back to the input), and it is
the one place that parses codes, for the printer (#42) and the editor features (#4, #5). In the
test game, `\c` (47k), `\i` (23k), `\{ \}` and `\> \<` (23k each) are the most used codes.

### 4.6 Comments

`//` comments run to the end of the line. They are **MV comments** (command `108`), not
annotations of the script: see [7.3](#73-comments). There are no block comments.

## 5. Names and references

### 5.1 Collections

Everything a command refers to by id is written as a property of a global collection:

| Collection     | Holds                    | Source                      |
| -------------- | ------------------------ | --------------------------- |
| `switches`     | Switches                 | `System.json` `switches`    |
| `variables`    | Variables                | `System.json` `variables`   |
| `commonEvents` | Common events            | `CommonEvents.json`         |
| `actors`       | Actors                   | `Actors.json`               |
| `classes`      | Classes                  | `Classes.json`              |
| `skills`       | Skills                   | `Skills.json`               |
| `items`        | Items                    | `Items.json`                |
| `weapons`      | Weapons                  | `Weapons.json`              |
| `armors`       | Armors                   | `Armors.json`               |
| `enemies`      | Enemies (database kinds) | `Enemies.json`              |
| `troops`       | Troops                   | `Troops.json`               |
| `states`       | States                   | `States.json`               |
| `animations`   | Animations               | `Animations.json`           |
| `tilesets`     | Tilesets                 | `Tilesets.json`             |
| `maps`         | Maps                     | `MapInfos.json`             |
| `elements`     | Elements                 | `System.json` `elements`    |
| `skillTypes`   | Skill types              | `System.json` `skillTypes`  |
| `weaponTypes`  | Weapon types             | `System.json` `weaponTypes` |
| `armorTypes`   | Armor types              | `System.json` `armorTypes`  |
| `equipTypes`   | Equipment types          | `System.json` `equipTypes`  |

### 5.2 Reference forms

The symbol table (#38) formats and resolves references. For an entry of a collection:

| The entry's name is                                     | Form                    |
| ------------------------------------------------------- | ----------------------- |
| a valid identifier, and unique within its collection    | `switches.Guard_Thrust` |
| non-empty and unique, but not an identifier             | `switches["Light on"]`  |
| empty, or shared with another id of the same collection | `switches[35]`          |

- Uniqueness is exact, case-sensitive string equality within the collection. `Door` and `door`
  are different names.
- The string in the bracket form follows [4.4](#44-string-literals).
- Reserved words are allowed after the dot (`switches.new`).
- The compiler accepts all three forms for any entry. The id form always works, even for an
  entry that has a unique name. A name that matches no entry, or matches several, is an error
  that lists the candidate ids.

### 5.3 Self switches

Self switches aren't database entries, so they aren't symbols: `selfSwitches.A` to
`selfSwitches.D`, always of the current event.

```ts
selfSwitches.A = true;
if (selfSwitches.B) { … }
```

### 5.4 Characters

Several commands act on a **character**: something on the map that can move and show
animations. MV stores it as a number: `-1` the player, `0` the event that is running, and a
positive number for another event on the current map.

| Form          | Meaning                           |
| ------------- | --------------------------------- |
| `player`      | The player (`-1`)                 |
| `thisEvent`   | The event that is running (`0`)   |
| `events.Gate` | Another event on the map, by name |
| `events[12]`  | Another event on the map, by id   |

Map events are not database entries: each map has its own events, numbered from 1. So `events`
is scoped to a map and uses the rules of [5.2](#52-reference-forms) among the events of that
map. Only a map event's script knows its map, so a common event or a troop always uses the id
form `events[12]`, which means "event 12 of whatever map is current when this runs".

`thisEvent` and the event's own id are different data (`0` vs `12`), and each prints as stored.

### 5.5 Values from variables

Many MV commands take either a constant or "the value of variable N". The script writes the
variable reference in place of the number:

```ts
changeGold(+100); // constant
changeGold(-variables.Price); // the value of variable Price
```

Where a command takes a **database id** from a variable, the script indexes the collection with
the variable:

```ts
battle(troops.Cave_bats); // troop by id
battle(troops[variables.Next_troop]); // the troop whose id is in variable Next_troop
```

The compiler derives the "designation" parameter (constant or variable) from which form is used.

### 5.6 Enumerations and options

- **Enum values** print as string literals using the catalog's value names (`"dim"`,
  `"middle"`, `"up"`). A value the catalog doesn't know prints as its number.
- **Options** are an object literal as the last argument, with identifier keys:
  `showText({ background: "dim" }, "…")`. Options with default values are left out.
- **Booleans** are `true` and `false`.

## 6. Containers and pages

A **container** is a common event, a map event or a troop. Its header is a decorator. A script
document holds one or more containers; how the editor splits a project into documents is up to
#4 (one map's events naturally share a document, because `events.X` is scoped to the map).

### 6.1 Names of functions and classes

A container prints as a `function` (common events) or a `class` (map events, troops). Its name is
the container's MV name when that name:

1. is a valid identifier ([4.2](#42-identifiers-and-reserved-words)),
2. is not a reserved word,
3. is unique among the containers of its kind (common events in the database, events on the same
   map, troops in the database), and
4. doesn't look like another container's fallback name (below).

Otherwise the name is a **fallback**, `commonEvent<id>`, `event<id>` or `troop<id>` (for example
`commonEvent12`), and the decorator carries the exact MV name as `name: "…"`, even when it is
empty (`name: ""`). A name like `troop7` counts as a fallback name, so it is used as the class
name only by troop 7 itself.

The compiler takes the MV name from `name` when present, otherwise from the function or class
name. The decorator's `id` says which container it is.

In the test game, 325 of 600 common events and 226 of 300 troops have identifier names. Most
map events keep the editor's default name `EV001`, which is an identifier.

### 6.2 Common events

```ts
@commonEvent({ id: 3, trigger: "parallel", switch: switches.Rain_falling })
function Rain_sounds() {
	…
}
```

| Key       | Values                                                                                    |
| --------- | ----------------------------------------------------------------------------------------- |
| `id`      | The common event's id                                                                     |
| `name`    | Only when the function name isn't the MV name ([6.1](#61-names-of-functions-and-classes)) |
| `trigger` | `"none"` (only runs when called), `"autorun"`, `"parallel"`                               |
| `switch`  | The switch that runs it. Printed only when `trigger` isn't `"none"`                       |

### 6.3 Map events

```ts
@event({ id: 4, x: 12, y: 8 })
class Old_gate {
	@page({ trigger: "action" })
	page1() {
		…
	}

	@page({ trigger: "action", when: selfSwitches.A })
	page2() {}
}
```

| Key            | Values                                                                                 |
| -------------- | -------------------------------------------------------------------------------------- |
| `id`, `name`   | As for common events                                                                   |
| `x`, `y`       | The event's tile position                                                              |
| page `trigger` | `"action"` (action button), `"playerTouch"`, `"eventTouch"`, `"autorun"`, `"parallel"` |
| page `when`    | The page conditions ([6.5](#65-page-conditions-when)). Left out when there are none    |

- Pages are methods named `page1`, `page2`, … in order. Their position is what counts: the
  method names are for reading.
- `trigger` is always printed, because the default isn't obvious to a new reader.
- A page's graphic, priority, movement settings and autonomous move route aren't part of the
  script. They are kept from the file (principle 4).

### 6.4 Troops

```ts
@troop({ id: 7, name: "Cave bats" })
class troop7 {
	@page({ span: "battle", when: turn(0) })
	page1() {
		…
	}
}
```

| Key          | Values                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `id`, `name` | As for common events                                                                              |
| page `span`  | `"battle"` (once per battle), `"turn"` (once per turn), `"moment"` (whenever the conditions hold) |
| page `when`  | The page conditions ([6.5](#65-page-conditions-when))                                             |

The troop's enemies and their positions aren't part of the script (principle 4). Hovers on
`members[i]` show which enemy a member is.

### 6.5 Page conditions (`when`)

A page's conditions are a conjunction (`&&`) of checks. Each kind of check appears at most once
(map pages allow two switches). There is no `||`, `!` or parentheses, because MV has no such
conditions.

**Map event pages:**

```ebnf
MapWhen  = MapCheck { "&&" MapCheck } ;
MapCheck = SwitchRef                          (* switch 1 or 2: the switch is ON *)
         | VariableRef ">=" Integer           (* the variable is at least the value *)
         | "selfSwitches." ( "A" | "B" | "C" | "D" )
         | "party.has(" ItemRef ")"           (* the party has the item *)
         | "party.has(" ActorRef ")" ;        (* the actor is in the party *)
```

Example: `when: switches.Gate_open && variables.Day >= 3 && party.has(items.Lantern)`.

**Troop pages:**

```ebnf
TroopWhen  = TroopCheck { "&&" TroopCheck } ;
TroopCheck = "turnEnd"                                    (* at the end of a turn *)
           | "turn(" Integer [ "," Integer ] ")"          (* turn a, or turn a then every b turns *)
           | "members[" Integer "].hpPercent" "<=" Integer (* troop member's HP, in percent *)
           | ActorRef ".hpPercent" "<=" Integer           (* actor's HP, in percent *)
           | SwitchRef ;                                  (* the switch is ON *)
```

`turn(a, b)` holds on turn `a`, then every `b` turns (`turn(2, 3)`: turns 2, 5, 8, …). `turn(0)`
is the start of the battle. Troop members are numbered from 0 in the order of the troop's
member list.

**Printing and compiling.**

- Checks print in the order of the MV editor: map pages switch 1, switch 2, variable, self switch,
  item, actor; troop pages turn end, turn, member HP, actor HP, switch. The parser accepts any
  order.
- MV stores each check in a slot with a "valid" flag, and keeps the ids of slots that are off.
  If the parsed conditions are equivalent to the stored ones, the compiler keeps the stored
  object unchanged. This keeps unused ids, and which switch slot a switch was in (the test game
  has 56 pages that use only switch 2).
- Conditions that `when` can't express (a self switch other than A–D, an out-of-range enemy
  index, …) print as `conditions: { … }` with the stored JSON instead of `when`.

## 7. Statements

### 7.1 Command calls

Most commands are calls: `name(arguments);`. Unless [section 8](#8-commands-by-group) says
otherwise, `name` is the command's catalog name (`showText`, `fadeoutScreen`, …) and arguments
are its parameters in catalog order, with options last.

Some commands have more natural forms: assignments (`switches.X = true;`), calls on a reference
(`commonEvents.Heal_party();`), or keywords (`break;`, `return;`).

### 7.2 Blocks

Commands that contain other commands are blocks. Conditional branches and loops use
TypeScript's own syntax:

```ts
if (switches.Door_open) {
	…
} else if (variables.Knocks >= 3) {
	…
} else {
	…
}

while (true) {
	…
	break;
}
```

- `else if` is shorthand for an `else` whose body is exactly one conditional branch. The
  compiler expands it. The test game has 23,079 such chains, so this removes a lot of nesting.
- An empty `else {}` is printed when the list has an Else branch with no commands, because MV
  records whether the branch exists.

Other block commands have no TypeScript equivalent. They are a call followed by a body of named
branches, similar to the MV editor's own layout:

```ts
showChoices({ cancel: 1 }) {
	when("Yes") {
		…
	}
	when("No") {}
}
```

The choice block, battle processing and move routes use this form ([8.2](#82-messages-comments-scripts-and-plugin-commands),
[8.3](#83-movement-characters-screen-audio-and-pictures), [8.4](#84-battle-and-remaining-commands)).
A choice block deliberately isn't a `switch` statement: in TypeScript, `break` inside a `case`
would leave the `switch`, but in MV it leaves the enclosing loop.

### 7.3 Comments

A Comment command (`108`, plus a `408` for each further line) prints as `//` lines, one per line
of text:

```ts
// <follower touch>
// Triggers when a follower touches this event.
showText("…");
```

- The printer writes `// ` followed by the text. The parser takes everything after `//`, minus
  one leading space if there is one. So `//` alone is an empty line, and `//  x` keeps one space.
- Consecutive `//` lines form one Comment command. A blank line between two runs of `//` lines
  starts a new Comment command.
- Comments are commands, so they only appear on their own lines inside a body. A comment after a
  statement on the same line is an error. A comment outside any body (between pages, before a
  container) is not saved, and the compiler warns about it.
- When `//` lines wouldn't round-trip (a line ends with whitespace that an editor might trim; the
  test game has 7), the printer writes `comment("line 1", "line 2");` instead. The parser accepts
  that form anywhere.

**Rationale.** A comment statement (`comment("…")`) is exact, but most MV comments are real
comments by the game's author, and `//` is where a reader looks for them. Making `//` the MV
comment also means comments the user writes are saved, rather than silently dropped on compile.
Plugin tags in comments (`<follower touch>`) stay exactly as written.

### 7.4 Raw fallback

Any command without dedicated syntax, or whose data the dedicated syntax can't reproduce exactly,
prints as:

```ts
command(232, [1, 0, 0, 0, 408, 312, 100, 100, 255, 0, 60, true]);
```

- The second argument is the command's `parameters` as **JSON** (the only place with JSON's
  escape rules). The parser reads it as JSON.
- `indent` is derived from the nesting, like for every other command. When the stored indent
  differs (malformed data), it prints as an option: `command(412, [], { indent: 3 });`.
- Structural codes that don't fit the expected structure (an orphaned `411`, a missing `412`)
  also print raw, each on its own line, so any list decompiles.

## 8. Commands by group

In the tables, `…` stands for more arguments of the same kind, `{ opts }` for the options object,
and `character` for a [character reference](#54-characters).

### 8.1 Flow control and game state

**Outline** (#41 finalizes).

| Code(s)         | Command               | Script                                                                    |
| --------------- | --------------------- | ------------------------------------------------------------------------- |
| 111 / 411 / 412 | Conditional Branch    | `if (condition) { … } else { … }`; conditions below                       |
| 112 / 413       | Loop                  | `while (true) { … }`                                                      |
| 113             | Break Loop            | `break;`                                                                  |
| 115             | Exit Event Processing | `return;`                                                                 |
| 117             | Common Event          | `commonEvents.Heal_party();`                                              |
| 118             | Label                 | `label("Start");`                                                         |
| 119             | Jump to Label         | `jumpTo("Start");`                                                        |
| 121             | Control Switches      | `switches.Door_open = true;`, ranges `switches[10..15] = false;`          |
| 122             | Control Variables     | `variables.Gold_found = 5;`, operators `= += -= *= /= %=`; operands below |
| 123             | Control Self Switch   | `selfSwitches.A = true;`                                                  |
| 124             | Control Timer         | `timer.start(90);` (seconds), `timer.stop();`                             |

**Conditions of `111`**, by condition type:

| Type        | Script                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| switch      | `switches.X` (ON), `!switches.X` (OFF)                                                                                                                                                                       |
| variable    | `variables.X >= 5`, `variables.X === variables.Y`; operators `=== >= <= > < !==` (parser also takes `==`, `!=`)                                                                                              |
| self switch | `selfSwitches.A`, `!selfSwitches.A`                                                                                                                                                                          |
| timer       | `timer.seconds >= 60`, `timer.seconds <= 60`                                                                                                                                                                 |
| actor       | `party.has(actors.X)`, `actors.X.name === "…"`, `actors.X.class === classes.Y`, `actors.X.hasSkill(skills.Y)`, `actors.X.hasWeapon(weapons.Y)`, `actors.X.hasArmor(armors.Y)`, `actors.X.hasState(states.Y)` |
| enemy       | `members[0].appeared`, `members[0].hasState(states.Y)`                                                                                                                                                       |
| character   | `player.direction === "up"`, `events.Guard.direction === "left"`                                                                                                                                             |
| gold        | `party.gold >= 100`, `party.gold <= 100`, `party.gold < 100`                                                                                                                                                 |
| item        | `party.has(items.X)`                                                                                                                                                                                         |
| weapon      | `party.has(weapons.X)`, `party.has(weapons.X, { includeEquipment: true })`                                                                                                                                   |
| armor       | `party.has(armors.X)`, `party.has(armors.X, { includeEquipment: true })`                                                                                                                                     |
| button      | `input.isPressed("ok")`                                                                                                                                                                                      |
| script      | `script("$gameParty.size() > 2")`                                                                                                                                                                            |
| vehicle     | `player.isRiding("boat")`                                                                                                                                                                                    |

**Operands of `122`:** a constant (`5`), a variable (`variables.Y`), `random(1, 6)` (inclusive),
`script("…")`, or game data:

| Game data           | Script                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| item, weapon, armor | `party.count(items.X)` (how many the party has)                                                                                                                      |
| actor               | `actors.X.level`, `.exp`, `.hp`, `.mp`, `.maxHp`, `.maxMp`, `.attack`, … (the catalog's parameter names)                                                             |
| enemy               | `members[0].hp`, `.mp`, `.maxHp`, …                                                                                                                                  |
| character           | `player.x`, `thisEvent.y`, `events.Guard.direction`, `.screenX`, `.screenY`                                                                                          |
| party               | `party.members[0]` (the actor id of the first member)                                                                                                                |
| other               | `game.mapId`, `party.size`, `party.gold`, `party.steps`, `game.playTime`, `timer.seconds`, `game.saveCount`, `game.battleCount`, `game.winCount`, `game.escapeCount` |

**Parameter counts.** The script leaves out how many parameters a `111` or `122` has, because the
condition or operand type fixes it. The compiler writes these counts (each was constant for its
type in the test game):

| `111` condition type                                 | Count                                    |
| ---------------------------------------------------- | ---------------------------------------- |
| switch, self switch, timer, character, weapon, armor | 3                                        |
| variable                                             | 5                                        |
| item, button, script, vehicle                        | 2                                        |
| actor                                                | 3 for "in party", 4 for the other checks |
| enemy                                                | 3 for "appeared", 4 for "state"          |
| gold (unused in the test game)                       | 3, per `Game_Interpreter.command111`     |

| `122` operand type | constant | variable | script | random | game data |
| ------------------ | -------- | -------- | ------ | ------ | --------- |
| Count              | 5        | 5        | 5      | 6      | 7         |

### 8.2 Messages, comments, scripts and plugin commands

**Outline** (#42 finalizes).

| Code(s)               | Command             | Script                                                             |
| --------------------- | ------------------- | ------------------------------------------------------------------ |
| 101 + 401             | Show Text           | `showText({ opts }, "line", …);` (see below)                       |
| 102 / 402 / 403 / 404 | Show Choices        | choice block (see below)                                           |
| 103                   | Input Number        | `inputNumber(variables.Code, 4);` (variable, digits)               |
| 104                   | Select Item         | `selectItem(variables.Chosen, "keyItem");`                         |
| 105 + 405             | Show Scrolling Text | `showScrollingText({ speed: 3, noFastForward: true }, "line", …);` |
| 108 + 408             | Comment             | `//` lines ([7.3](#73-comments))                                   |
| 355 + 655             | Script              | `script("line", …);`                                               |
| 356                   | Plugin Command      | `plugin.Head(arg, …);` or `plugin("…");` (see below)               |

**Show Text.** Each text line (`401`) is one string argument. One line prints on one line; two or
more print one per line:

```ts
showText("Just one line.");
showText(
	{ face: "Guard", faceIndex: 2, position: "middle" },
	"Halt! Who goes there?",
	"\c[2]State your business.\c[0]",
);
```

Options and their defaults (the MV editor's): `face: ""`, `faceIndex: 0`, `background:
"window"` (`"dim"`, `"transparent"`), `position: "bottom"` (`"top"`, `"middle"`).

**Show Choices.** One `when` branch per choice, in order, with the choice text. The texts are not
repeated anywhere else (the `402` copies are derived):

```ts
showChoices({ cancel: "branch", position: "middle" }) {
	when("Buy") {
		…
	}
	when("Sell") {
		…
	}
	whenCancel {
		…
	}
}
```

- `cancel` says what the cancel button does: `"disallow"` (`-1`), a choice index from 0 (acts as
  that choice), or `"branch"` (runs the `whenCancel` branch). It is always printed, because the
  MV editor's default (choice index 1) is easy to misread.
- Other options: `default` (the initially selected choice index, or `"none"`; default `0`),
  `position` (`"left"`, `"middle"`, `"right"`; default `"right"`), `background` (as for Show
  Text; default `"window"`).
- To settle in #42: which stored value `"branch"` stands for. The engine treats any value at or
  beyond the number of choices as "branch"; the printer must keep the exact number.

**Script.** Each line of JavaScript is one string, laid out like Show Text. Editor support for
the embedded JavaScript is #7.

**Plugin commands.** MV stores a plugin command as one line, `Head arg1 arg2`. The script splits
it at single spaces:

- The head becomes a method of `plugin`: `plugin.LightOn(…)`. It must be an identifier (reserved
  words are fine after the dot).
- An argument that is a canonical, finite number (`String(Number(t)) === t` and
  `Number.isFinite(Number(t))`) prints bare; any other argument prints as a string literal.
- The compiler joins the head and arguments with single spaces.
- A line that doesn't split cleanly prints as `plugin("…")` with the whole line: the head isn't
  an identifier, or splitting gives empty pieces (double, leading or trailing spaces).

| Stored line        | Script                           | Why                                  |
| ------------------ | -------------------------------- | ------------------------------------ |
| `Lighting on 3`    | `plugin.Lighting("on", 3);`      |                                      |
| `Fog show 1 0.5`   | `plugin.Fog("show", 1, 0.5);`    |                                      |
| `QuestLog add 007` | `plugin.QuestLog("add", "007");` | `007` isn't canonical (`7` would be) |
| `Weather  rain`    | `plugin("Weather  rain");`       | Two spaces give an empty argument    |
| `Layer.set(1);`    | `plugin("Layer.set(1);");`       | The head isn't an identifier         |

In the test game, 48,014 of 48,016 plugin commands split cleanly. Per-plugin syntax and docs are
#7.

### 8.3 Movement, characters, screen, audio and pictures

**Outline** (#43 finalizes).

| Code(s)          | Command              | Script                                                                                                  |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| 205 + 505        | Set Movement Route   | route block (see below)                                                                                 |
| 201              | Transfer Player      | `transferPlayer(maps.Forest, 10, 5, { direction: "up", fade: "white" });`                               |
| 202              | Set Vehicle Location | `setVehicleLocation("boat", maps.Harbor, 4, 9);`                                                        |
| 203              | Set Event Location   | `setEventLocation(character, 3, 4, { direction: "down" });`, or `{ swapWith: character }`               |
| 204              | Scroll Map           | `scrollMap("up", 5, { speed: 4 });`                                                                     |
| 206              | Get on/off Vehicle   | `getOnOffVehicle();`                                                                                    |
| 211              | Change Transparency  | `changeTransparency(true);` (true: the player is invisible)                                             |
| 212              | Show Animation       | `showAnimation(character, animations.Slash, { wait: true });`                                           |
| 213              | Show Balloon Icon    | `showBalloonIcon(character, "exclamation", { wait: true });`                                            |
| 214              | Erase Event          | `eraseEvent();`                                                                                         |
| 216, 217         | Followers            | `changePlayerFollowers(false);`, `gatherFollowers();`                                                   |
| 230              | Wait                 | `wait(60);` (frames; 60 is one second)                                                                  |
| 221, 222         | Fade screen          | `fadeoutScreen();`, `fadeinScreen();`                                                                   |
| 223              | Tint Screen          | `tintScreen([-68, -68, 0, 68], 60, { wait: true });` (red, green, blue, gray)                           |
| 224              | Flash Screen         | `flashScreen([255, 255, 255, 170], 8, { wait: true });` (red, green, blue, strength)                    |
| 225              | Shake Screen         | `shakeScreen(5, 5, 30, { wait: true });` (power, speed, frames)                                         |
| 236              | Set Weather Effect   | `setWeatherEffect("rain", 5, 60, { wait: true });`                                                      |
| 241–246, 249–251 | Audio                | `playBgm("Town1", { volume: 80 });`, `fadeoutBgm(3);`, `saveBgm();`, `playSe("Door1");`, …              |
| 261              | Play Movie           | `playMovie("Intro");`                                                                                   |
| 231–235          | Pictures             | `showPicture(1, "Map_overlay", { x: 0, y: 0, opacity: 200 });`, `movePicture(…)`, `erasePicture(1);`, … |

Audio defaults (left out): `volume: 90`, `pitch: 100`, `pan: 0`. Movement arguments follow
[5.5](#55-values-from-variables): `transferPlayer(maps[variables.To_map], variables.To_x,
variables.To_y)` uses variables.

**Move routes.** A route is a block of move steps. Each step is a call to its move-command
catalog name (`MOVE_ROUTE_COMMANDS`):

```ts
setMovementRoute(player, { skippable: true }) {
	turnUp();
	moveUp();
	wait(15);
	playSe("Knock");
	script("this.setOpacity(128)");
}
```

- Options and defaults (the MV editor's): `repeat: false`, `skippable: false`, `wait: true`.
- Inside a route body only move steps are allowed, so `wait(15)` is the move-route Wait.
- The `505` lines after a `205` are copies of the steps, and the route's final `{ "code": 0 }`
  is its terminator. Both are derived.
- To settle in #43: 3,369 steps in the test game store `indent: 0` instead of the usual `null`.
  The engine ignores a step's indent, and the `0`s look like an editor artifact: they are spread
  over 17 step codes and mostly sit mid-route, and 1,030 routes mix `0` and `null` steps. So a
  route-level option can't keep them. It has to be per step, for example an option like the raw
  fallback's (`moveUp({ indent: 0 });`) or a raw step form (`step({ … })`).

### 8.4 Battle and remaining commands

**Outline** (#44 finalizes).

**Battle Processing** (`301`) prints as a plain call when it has no result branches, and as a
block otherwise:

```ts
battle(troops.Cave_bats);

battle(troops[variables.Next_troop]) {
	ifWin {
		…
	}
	ifEscape {
		…
	}
	ifLose {
		…
	}
}
```

- The troop is `troops.X`, `troops[variables.V]`, or `"randomEncounter"` (the map's encounter
  list).
- The branches are `ifWin` (`601`), `ifEscape` (`602`) and `ifLose` (`603`). The flags Can
  Escape and Can Lose are not printed: they are true exactly when the `ifEscape` and `ifLose`
  branches are present. In the test game, 288 battles have no branches, 1,180 have win and escape,
  and 316 have all three.

**Actors and enemies.** Actor commands take `actors.X`, `actors[variables.V]` or `party` (the
whole party). Enemy commands take `members[i]` (a troop member, from 0) or `members.all`. An
amount with an operation prints signed: `+10` increases, `-variables.Damage` decreases.

| Code(s)           | Command                     | Script                                                                                                                                                            |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 302 + 605         | Shop Processing             | `shop({ purchaseOnly: true }) { goods(items.Potion); goods(weapons.Club, { price: 50 }); }`                                                                       |
| 125               | Change Gold                 | `changeGold(+100);`                                                                                                                                               |
| 126–128           | Change Items/Weapons/Armors | `changeItems(items.Potion, +1);`, `changeWeapons(weapons.Club, -1, { includeEquipment: true });`                                                                  |
| 129               | Change Party Member         | `changePartyMember(actors.Mira, "add", { initialize: true });`                                                                                                    |
| 311–326           | Actor commands              | `changeHp(party, -10, { allowKnockout: false });`, `changeState(actors.Mira, "add", states.Poison);`, `recoverAll(party);`, `changeName(actors.Mira, "Mira");`, … |
| 331–340, 342      | Enemy commands              | `changeEnemyHp(members[0], -50);`, `enemyAppear(members[2]);`, `forceAction(members[0], skills.Bite, "random");`, `abortBattle();`, …                             |
| 132–140, 322, 323 | System settings             | `changeBattleBgm("Battle2");`, `changeSaveAccess(false);`, `changeWindowColor([0, 0, 64, 0]);`, …                                                                 |
| 281–285           | Map commands                | `changeMapNameDisplay(true);`, `changeTileset(tilesets.Dungeon);`, `getLocationInfo(variables.Tile, "regionId", 5, 6);`, …                                        |
| 303, 351–354      | Scene control               | `nameInputProcessing(actors.Mira, 8);`, `openMenuScreen();`, `gameOver();`, …                                                                                     |

#44 also records any catalog code that deliberately keeps the raw fallback.

## 9. Data the script leaves out

The compiler regenerates all of this:

| Data                                           | Why it can be left out                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `indent` of every command                      | It is the nesting depth (the raw fallback prints it when it differs)         |
| `0` terminators                                | One ends every branch body and every list                                    |
| Block ends `412`, `404`, `413`, `604`          | They are the closing `}` of the block                                        |
| Branch starts `411`, `402`, `403`, `601`–`603` | They are `else`, `when`, `whenCancel`, `ifWin`, …                            |
| The choice index and text in `402`             | The index is the branch's position; the text is a copy from `102`            |
| `505` Movement Route Step lines                | Copies of the route's steps                                                  |
| A move route's final `{ "code": 0 }`           | It ends every route                                                          |
| Parameter counts of `111` and `122`            | Fixed by condition and operand type ([8.1](#81-flow-control-and-game-state)) |
| Can Escape and Can Lose of `301`               | Present exactly when the `ifEscape` and `ifLose` branches are                |
| Designation parameters                         | Whether a constant or a variable is used ([5.5](#55-values-from-variables))  |
| Options at their default value                 | The compiler writes the default                                              |

Kept from the file instead (principle 4): page graphics and movement settings, troop members,
unused page-condition slots, and a common event's switch while its trigger is `"none"`.

## 10. Worked examples

These examples are invented, and use syntax from the outlines above.

### 10.1 A common event

An inn: the player chooses whether to rest, pays if they can, and the screen fades while the
party recovers.

```ts
@commonEvent({ id: 12, name: "Rest at inn", trigger: "none" })
function commonEvent12() {
	showText({ face: "Innkeeper", faceIndex: 1 }, "A bed for the night is 50\G.");
	showChoices({ cancel: 1 }) {
		when("Stay") {
			if (party.gold >= 50) {
				changeGold(-50);
				fadeoutScreen();
				playMe("Inn");
				recoverAll(party);
				variables.Nights_rested += 1;
				fadeinScreen();
				showText("\N[1] feels rested.");
			} else {
				showText("You can't afford it.");
			}
		}
		when("Leave") {}
	}
}
```

The MV name "Rest at inn" isn't an identifier, so the function has a fallback name and the
decorator carries the name.

### 10.2 A map event with two pages

A locked gate. Page 1 runs when the player presses the action button at the gate. Once opened,
self switch A is ON, so page 2 (the higher page whose conditions hold) takes over, and walking
into the gate leads to the next map.

```ts
@event({ id: 4, x: 12, y: 8 })
class Old_gate {
	@page({ trigger: "action" })
	page1() {
		if (party.has(items.Rusty_key)) {
			// <sound: creak>
			playSe("Open1");
			showText(
				"The key turns with a scrape.",
				"\c[2]The gate is open.\c[0]",
			);
			changeItems(items.Rusty_key, -1);
			selfSwitches.A = true;
		} else {
			showBalloonIcon(player, "question", { wait: true });
			showText("It's locked.");
		}
	}

	@page({ trigger: "playerTouch", when: selfSwitches.A })
	page2() {
		setMovementRoute(player) {
			moveUp();
		}
		plugin.Lighting("off");
		transferPlayer(maps.Old_forest, 10, 20, { direction: "up" });
	}
}
```

- The event's MV name, `Old_gate`, is an identifier, so it is the class name and the decorator
  has no `name`.
- `// <sound: creak>` is an MV comment that a plugin might read. It is saved as a `108` command.
- `\c[2]` and `\c[0]` are text codes, written exactly as MV stores them.
- The route block has no options, so it uses the defaults: not repeating, not skippable, and the
  event waits for the route to finish.

### 10.3 A troop

At the start of the battle a message shows. When the leader (member 0) drops to half HP, it
calls for help once, and another bat appears.

```ts
@troop({ id: 7, name: "Cave bats" })
class troop7 {
	@page({ span: "battle", when: turn(0) })
	page1() {
		showText("Bats swarm out of the dark!");
	}

	@page({ span: "battle", when: members[0].hpPercent <= 50 })
	page2() {
		showText("\c[2]The bat shrieks for help!\c[0]");
		enemyAppear(members[2]);
		switches.Bats_called_help = true;
	}
}
```

## 11. Open questions

- **Show Choices "branch" value** ([8.2](#82-messages-comments-scripts-and-plugin-commands)):
  which number the MV editor stores for a When Cancel branch, so `"branch"` can stand for it and
  other values print as numbers. The engine (`Game_Interpreter.setupChoices`) turns any value at
  or beyond the number of choices into "branch", so until this is settled the printer keeps such
  values as numbers.
- **Move route step indents** ([8.3](#83-movement-characters-screen-audio-and-pictures)): how to
  keep the 3,369 steps that store `indent: 0`. It has to be per step, since routes mix `0` and
  `null`.
- **Page settings.** The script doesn't show a page's graphic or movement settings. A later
  version could print them as more `@page` options if editing them in the script is wanted.
- **Document context.** A map event's script doesn't name its map; the document does (#4). A
  `@map({ id })` header could make a standalone script self-describing.
