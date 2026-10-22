export {};
// Runs the Vite dev server and Electron together. Only the launcher runs on Bun:
// Electron's own main process always runs on the Node bundled inside Electron.
const url = 'http://127.0.0.1:5173';
const bun = process.execPath;

const vite = Bun.spawn([bun, 'x', '--bun', 'vite'], { stdout: 'inherit', stderr: 'inherit' });
const stop = (code = 0): never => {
  vite.kill();
  process.exit(code);
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

const ready = async (): Promise<boolean> => {
  for (let i = 0; i < 200; i++) {
    if (vite.exitCode !== null) return false;
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not listening yet */
    }
    await Bun.sleep(150);
  }
  return false;
};
if (!(await ready())) {
  console.error('Vite did not start (is port 5173 already in use?)');
  stop(1);
}

const built = Bun.spawn([bun, 'scripts/build-main.mjs'], { stdout: 'inherit', stderr: 'inherit' });
if ((await built.exited) !== 0) stop(1);

// Extra CLI args go to Electron, e.g. `bun run dev:electron --no-sandbox` when running as root in a container.
const electron = Bun.spawn(['node_modules/.bin/electron', '.', ...Bun.argv.slice(2)], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, LOOM_DEV_URL: url },
});
stop(await electron.exited);
