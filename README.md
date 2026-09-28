# rpgmv-event-tools

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
=== CommonEvent 2: "Light flashlight" ===
if S[3:"Toggle Flashlight"] == ON:
    S[3:"Toggle Flashlight"] = OFF
else:
    S[3:"Toggle Flashlight"] = ON
```

## Status

Early planning. Work is tracked in GitHub issues (see the `epic` label).

## Game data

This repository contains no game data. Development and tests run against a local
copy of an MV game, configured by path, which is never committed.
