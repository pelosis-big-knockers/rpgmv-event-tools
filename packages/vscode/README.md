# RPG Maker MV Event Tools

Read, navigate and edit RPG Maker MV event logic (common events, map events and troop events)
as readable script instead of raw JSON.

> **Early development.** This version browses and reads event logic. Navigation and editing
> are planned; see the
> [project issues](https://github.com/pelosis-big-knockers/rpgmv-event-tools/issues).

## Features

- **Project detection:** when a workspace contains an MV game (an editor project, a deployed
  game with `www/data`, or a web deployment with `data/`), the extension activates and logs each
  project with its counts of common events, maps, switches and variables to the
  **RPG Maker MV** output channel.
- **Event explorer:** the **RPG Maker MV** view in the activity bar lists each project's common
  events, maps (nested as in the MV editor) with their events, and troops, with each map event's
  and troop's pages. A page's description sums up its trigger and conditions, such as
  `action · switches.Door_open`. Click an entry to open it as read-only script, or a page to open
  it at that page.

## Settings

- `rpgmvEventTools.showEmptyEntries` (default `false`): show the empty slots of common events
  and troops (no name and no commands) in the explorer.

## Requirements

A folder containing an RPG Maker MV project or deployed game. Nothing else is needed.

## License

[MIT](https://github.com/pelosis-big-knockers/rpgmv-event-tools/blob/main/LICENSE)
