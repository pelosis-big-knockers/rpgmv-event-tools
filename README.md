# rpgmv-event-tools

[![CI](https://github.com/pelosis-big-knockers/rpgmv-event-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/pelosis-big-knockers/rpgmv-event-tools/actions/workflows/ci.yml)

Tools for reading, understanding and modifying RPG Maker MV event logic
(`CommonEvents.json`, `MapXXX.json`, `Troops.json`) as readable script instead of raw JSON.

Planned components:

- **Core library**: loads MV data files, decompiles event command lists to a readable
  script, compiles script back to JSON losslessly, and indexes cross-references
  (switches, variables, common events).
- **VS Code extension**: event explorer tree, decompiled script views, hover and
  go-to-definition, find-all-references, and editing with round-trip save.

Example of the decompiled output:

```
=== CommonEvent 1: "Toggle lantern" ===
if S[2:"Lantern lit"] == ON:
    S[2:"Lantern lit"] = OFF
    say "You put out the lantern."
else:
    S[2:"Lantern lit"] = ON
    say "You light the lantern."
```

## Status

Early planning. Work is tracked in GitHub issues (see the `epic` label).

## Game data

This repository contains no game data, and none should ever be committed. Unit tests use
small hand-written fixtures in `packages/core/test/fixtures/`.

### Testing against a real game

Some tests need a real MV game (for example, the byte-identical load/save and round-trip
checks). They are skipped unless you point them at a local copy, using either:

- the `RPGMV_TEST_GAME` environment variable:

  ```bash
  RPGMV_TEST_GAME="C:/Games/Some Game" npm test
  ```

  ```powershell
  $env:RPGMV_TEST_GAME = "C:/Games/Some Game"; npm test
  ```

- or a `test-data.local.json` file at the repo root (gitignored). Copy
  `test-data.local.example.json` and set `gamePath`:

  ```json
  { "gamePath": "../path/to/Some Game/www" }
  ```

The environment variable takes precedence. Relative paths are resolved against the repo root;
in JSON, use forward slashes or escaped backslashes.

The path can be the game's root folder (next to `Game.exe`), its `www/` folder, an editor
project folder (containing `Game.rpgproject`), or the `data/` folder itself. When no game is
configured, or the path isn't an MV game, those suites are reported as skipped and the suite
title says why.
