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
- Show JavaScript (Script commands, script conditions and operands, and move-route `script`
  steps) as lambdas, `script(() => …)`, highlighted as code. The code is kept exactly as stored;
  code that can't be a lambda stays a `script("…")` string.
