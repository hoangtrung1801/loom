const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

const buildOptions = {
	entryPoints: [path.join(__dirname, '..', 'electron', 'ts', 'main.ts')],
	bundle: true,
	platform: 'node',
	target: 'node24',
	format: 'cjs',
	outfile: path.join(__dirname, '..', 'electron.js'),
	sourcemap: false,
	external: [
		'electron',
		'electron-updater',
		'electron-util',
		'electron-log',
		'electron-json-storage',
		'electron-window-state',
		'electron-dl',
		'@electron/remote',
		'@electron/remote/main',
		'@tomjs/electron-devtools-installer',
		'keytar',
		'check-disk-space',
		'sanitize-filename',
		'mime-types',
		'linux-distro',
		'regedit',
	],
	tsconfig: path.join(__dirname, '..', 'tsconfig.electron.json'),
	logLevel: 'info',
};

// The AI agent (pi and its provider SDKs, ~2 MB) is a second bundle that electron.js requires on first
// use, so it costs nothing at startup. A dynamic import() would not do: esbuild hoists the ESM
// packages it pulls in into the main bundle and still runs them at launch.
const agentOptions = {
	...buildOptions,
	entryPoints: [path.join(__dirname, '..', 'electron', 'ts', 'agent', 'index.ts')],
	outfile: path.join(__dirname, '..', 'electron-agent.js'),
	external: [],
};

async function build() {
	if (watch) {
		for (const options of [ buildOptions, agentOptions ]) {
			const ctx = await esbuild.context(options);
			await ctx.watch();
		}
		console.log('[build-electron] Watching for changes...');
	} else {
		await Promise.all([ esbuild.build(buildOptions), esbuild.build(agentOptions) ]);
	}
}

build().catch((err) => {
	console.error(err);
	process.exit(1);
});
