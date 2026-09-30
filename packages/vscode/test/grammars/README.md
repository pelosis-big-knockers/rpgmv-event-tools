# Vendored grammar (tests only)

The script grammar (`syntaxes/rpgmv-script.tmLanguage.json`) builds on the TypeScript grammar
(`source.ts`). VS Code ships it, but the grammar tests run outside VS Code, so a copy is kept here.
It is used only by the tests and is not packaged in the extension.

- `TypeScript.tmLanguage.json`: `extensions/typescript-basics/syntaxes/` of
  [microsoft/vscode](https://github.com/microsoft/vscode), release 1.139.1

It is unmodified. VS Code converts it from
[microsoft/TypeScript-TmLanguage](https://github.com/microsoft/TypeScript-TmLanguage); the file's
`version` field names the commit. Both repositories are under the MIT License, copyright Microsoft
Corporation: see `LICENSE-vscode.txt` and `LICENSE-TypeScript-TmLanguage.txt`.

To update, download the file from a newer VS Code release, then run `npm run test:grammar -- -u`
and review the snapshot changes.
