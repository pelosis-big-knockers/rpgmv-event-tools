# Changelog

## 0.0.1 (unreleased)

- Detect RPG Maker MV projects in the workspace and log a summary of each to the
  **RPG Maker MV** output channel.
- Load every MV project in the workspace, following workspace folders as they are added and
  removed.
- Show a common event, map event or troop as a read-only script document (`rpgmv:` URIs), opened
  with the `rpgmvEventTools.openContainer` command, which can also scroll to a page.
- Add the `rpgmv-script` language (`.mvscript`) with highlighting for the event script: raw
  strings, text codes such as `\C[2]`, and raw `command(…)` lines.
- Add the event explorer: an **RPG Maker MV** view in the activity bar with each project's
  common events, maps (nested by parent, loaded when expanded) and their events, and troops,
  down to each page. Page descriptions and tooltips show the page's trigger and conditions as
  the script prints them. Clicking an entry opens its script, and clicking a page opens it at
  that page. Empty common event and troop slots are hidden unless
  `rpgmvEventTools.showEmptyEntries` is set.
- Show JavaScript (Script commands, script conditions and operands, and move-route `script`
  steps) as lambdas, `script(() => …)`, highlighted as code. The code is kept exactly as stored;
  code that can't be a lambda stays a `script("…")` string.
- Reload a project's data files when they change on disk, for example when the MV editor saves,
  and update the explorer and open scripts to match. A file that can't be read yet keeps its
  last good data until it changes again, and a script whose entry was deleted says so.
