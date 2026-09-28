import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {esbuild.BuildOptions} */
const options = {
	entryPoints: ["src/extension.ts"],
	outfile: "dist/extension.js",
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	external: ["vscode"],
	sourcemap: !production,
	minify: production,
	logLevel: "info",
};

if (watch) {
	const context = await esbuild.context(options);
	await context.watch();
} else {
	await esbuild.build(options);
}
