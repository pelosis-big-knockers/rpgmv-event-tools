# RPG Maker MV Event Tools

Read, navigate and edit RPG Maker MV event logic (common events, map events and troop events)
as readable script instead of raw JSON.

> **Early development.** This version only detects MV projects in your workspace. The event
> explorer, decompiled script views, navigation and editing are planned; see the
> [project issues](https://github.com/pelosis-big-knockers/rpgmv-event-tools/issues).

## Features

- **Project detection:** when a workspace contains an MV game (an editor project, a deployed
  game with `www/data`, or a web deployment with `data/`), the extension activates and logs each
  project with its counts of common events, maps, switches and variables to the
  **RPG Maker MV** output channel.

## Requirements

A folder containing an RPG Maker MV project or deployed game. Nothing else is needed.

## License

[MIT](https://github.com/pelosis-big-knockers/rpgmv-event-tools/blob/main/LICENSE)
