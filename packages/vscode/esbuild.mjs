import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/**
 * In watch mode, prints build start, end and errors in a fixed format for the problem matcher
 * of the "watch: esbuild" task in .vscode/tasks.json.
 *
 * @type {esbuild.Plugin}
 */
const problemMatcherOutput = {
	name: "problem-matcher-output",
	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started");
		});
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				const where = location ? `${location.file}:${location.line}:${location.column + 1}: ` : "";
				console.error(`✘ [ERROR] ${where}${text}`);
			}
			console.log("[watch] build finished");
		});
	},
};

/** @type {esbuild.BuildOptions} */
const options = {
	entryPoints: ["src/extension.ts"],
	outfile: "dist/extension.js",
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	external: ["vscode"],
	// Bundle core from source, so the extension build never waits for core's tsc output.
	alias: { "@rpgmv-event-tools/core": "../core/src/index.ts" },
	sourcemap: !production,
	minify: production,
	logLevel: watch ? "silent" : "info",
	plugins: watch ? [problemMatcherOutput] : [],
};

if (watch) {
	const context = await esbuild.context(options);
	await context.watch();
} else {
	await esbuild.build(options);
}
