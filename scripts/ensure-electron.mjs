// Electron downloads its binary in a postinstall script. Bun skips dependency install scripts unless
// they are trusted, so a plain `bun install` can leave Electron without a binary. This repairs that.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const dir = 'node_modules/electron';

function installed() {
  try {
    return existsSync(`${dir}/dist/${readFileSync(`${dir}/path.txt`, 'utf8')}`);
  } catch {
    return false;
  }
}

if (!installed()) {
  console.log('Electron binary is missing, downloading it now…');
  // install.js is Electron's own downloader; run it with Node when available, else with the current runtime.
  const node = spawnSync('node', ['--version']).status === 0 ? 'node' : process.execPath;
  const result = spawnSync(node, [`${dir}/install.js`], { stdio: 'inherit' });
  if (result.status !== 0 || !installed()) {
    console.error(
      '\nCould not download the Electron binary. Check your network/proxy, then run:\n' +
        '  rm -rf node_modules/electron && bun install\n',
    );
    process.exit(1);
  }
  console.log('Electron is ready.');
}
