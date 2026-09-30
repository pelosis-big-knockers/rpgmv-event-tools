# Test fixtures

Small, hand-written RPG Maker MV data files for unit tests. Everything here is invented;
never copy content from a real game into this folder.

Files keep the MV editor's own layout (one array entry per line, no extra whitespace),
so they are excluded from Prettier and marked `-text` in `.gitattributes` to preserve
their exact bytes.

- `basic/data/`: a minimal project with a few switches, variables and common events, a few
  actors and items (each list with one unused, empty-name slot), one small map (`Map001.json`,
  listed in `MapInfos.json`) with a two-page event, and one troop with two pages.
- `explorer/data/`: entries for the explorer's tree: common events and troops with and without
  names and commands, maps nested under each other out of id order (one listed without a file,
  one under a missing parent), map events with page conditions, and pages with and without the
  final `0`.

Like real MV files, fixtures have no trailing newline. Add new ones in the same layout; the
round-trip test in `mv-json.test.ts` checks every fixture file byte for byte.
