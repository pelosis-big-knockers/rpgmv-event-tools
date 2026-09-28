# Test fixtures

Small, hand-written RPG Maker MV data files for unit tests. Everything here is invented;
never copy content from a real game into this folder.

Files keep the MV editor's own layout (one array entry per line, no extra whitespace),
so they are excluded from Prettier and marked `-text` in `.gitattributes` to preserve
their exact bytes.

- `basic/data/`: a minimal project with a few switches, variables and common events, and one map entry in `MapInfos.json`.
