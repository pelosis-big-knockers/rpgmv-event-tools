import { CORE_VERSION } from "@rpgmv-event-tools/core";
import type * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext): void {
	console.log(`RPG Maker MV Event Tools activated (core ${CORE_VERSION})`);
}

export function deactivate(): void {}
