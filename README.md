# rpgmv-event-tools

[![CI](https://github.com/pelosis-big-knockers/rpgmv-event-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/pelosis-big-knockers/rpgmv-event-tools/actions/workflows/ci.yml)

Tools for reading, understanding and modifying RPG Maker MV event logic
(`CommonEvents.json`, `MapXXX.json`, `Troops.json`) as readable script instead of raw JSON.

Components:

- **Core library** (`packages/core`): loads MV data files, decompiles event command lists to a
  readable script, compiles script back to JSON losslessly, and indexes cross-references
  (switches, variables, common events). It has no VS Code dependency.
- **VS Code extension** (`packages/vscode`): event explorer tree, decompiled script views, hover
  and go-to-definition, find-all-references, and editing with round-trip save.

Example of the planned decompiled output (the syntax is specified in
[docs/script-syntax.md](docs/script-syntax.md)):

```ts
@commonEvent({ id: 1, trigger: "none" })
function Toggle_lantern() {
	if (switches["Lantern lit"]) {
		switches["Lantern lit"] = false;
		showText("You put out the lantern.");
	} else {
		switches["Lantern lit"] = true;
		showText("You light the lantern.");
	}
}
```

## Status

Early development. The project scaffolding is done and the extension detects MV projects in a
workspace; everything else is planned. Work is tracked in GitHub issues (see the `epic` label).

## Development

### Prerequisites

- Node.js 24 or newer (the version CI uses is in `.nvmrc`)
- VS Code, with the extensions this workspace recommends (VS Code offers them when you open the
  folder):
  - **TypeScript 7** (`TypeScriptTeam.native-preview`). The project uses TypeScript 7, and the
    workspace turns off VS Code's built-in TypeScript support in its favor, so without this
    extension you get no TypeScript language features.
  - **Oxc** (`oxc.oxc-vscode`) for lint errors in the editor
  - **Prettier** (`esbenp.prettier-vscode`) for format on save
  - **Vitest** (`vitest.explorer`) for running tests from the editor (optional)

### Setup

```bash
npm install
```

Use `npm install` rather than `npm ci` in a folder that VS Code has open. `npm ci` deletes
`node_modules` first, and on Windows that fails with `EPERM` while the Oxc and TypeScript 7
extensions have their native binaries in use.

### Scripts

| Script                            | What it does                                                    |
| --------------------------------- | --------------------------------------------------------------- |
| `npm run build`                   | Builds `core` with `tsc` and bundles the extension with esbuild |
| `npm run watch`                   | Rebuilds both on every change                                   |
| `npm run typecheck`               | Typechecks all packages, including tests                        |
| `npm run lint`                    | Lints with oxlint (warnings fail too)                           |
| `npm run format` / `format:check` | Formats with Prettier / checks formatting                       |
| `npm test`                        | Runs the Vitest suites                                          |
| `npm run package`                 | Builds a production `.vsix` in `packages/vscode/`               |

CI runs build, typecheck, lint, `format:check`, test and package on Ubuntu and Windows.

### Running the extension

Press **F5** in VS Code. It starts the `watch` build task and opens an Extension Development
Host. Pick a launch configuration in the Run and Debug view:

- **Run Extension (basic fixture)** opens the small invented project in
  `packages/core/test/fixtures/basic`, so it works from a fresh clone.
- **Run Extension (last opened folder)** reopens whatever folder you last used in the
  development host. Open a real game there once, and it's remembered.

The extension logs to the **RPG Maker MV** output channel. Build and type errors from the watch
tasks appear in the Problems panel.

`core` is bundled into the extension from source, so changes to either package are picked up by
the watch build without building `core` first.

### Packaging

```bash
npm run package
```

This produces `packages/vscode/rpgmv-event-tools-<version>.vsix`, a minified bundle without
source maps. Install it with **Extensions: Install from VSIX...** in VS Code, or:

```bash
code --install-extension packages/vscode/rpgmv-event-tools-0.0.1.vsix
```

The extension is published as `p-b-k` (extension ID `p-b-k.rpgmv-event-tools`), the same
publisher as `tw-sugarcube-ts-tools`.

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
