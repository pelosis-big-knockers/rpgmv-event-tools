# Vendored grammars (tests only)

The script grammar (`syntaxes/rpgmv-script.tmLanguage.json`) builds on the TypeScript grammar
(`source.ts`) and embeds the JavaScript grammar (`source.js`). VS Code ships both, but the grammar
tests run outside VS Code, so copies are kept here. They are used only by the tests and are not
packaged in the extension.

- `TypeScript.tmLanguage.json`: `extensions/typescript-basics/syntaxes/` of
  [microsoft/vscode](https://github.com/microsoft/vscode), release 1.139.1
- `JavaScript.tmLanguage.json`: `extensions/javascript/syntaxes/` of microsoft/vscode, release
  1.139.1

Both are unmodified. VS Code converts them from
[microsoft/TypeScript-TmLanguage](https://github.com/microsoft/TypeScript-TmLanguage); each file's
`version` field names the commit. Both repositories are under the MIT License, copyright Microsoft
Corporation: see `LICENSE-vscode.txt` and `LICENSE-TypeScript-TmLanguage.txt`.

To update, download both files from a newer VS Code release, then run `npm run test:grammar -- -u`
and review the snapshot changes.
