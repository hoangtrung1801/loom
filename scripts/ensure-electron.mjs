// Electron downloads its binary in a postinstall script. Bun skips dependency install scripts unless
// they are trusted, so a plain `bun install` can leave Electron without a binary. This repairs that.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'node_modules/electron';
// Electron's own lookup honours this override, so ours must too.
const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(dir, 'dist');

function installed() {
  try {
    return existsSync(join(distDir, readFileSync(join(dir, 'path.txt'), 'utf8')));
  } catch {
    return false;
  }
}

if (!installed()) {
  console.log('Electron binary is missing, downloading it now…');

  const env = { ...process.env };
  if (env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    // Electron's installer exits 0 without downloading anything when this is set, which looks like success.
    console.log(`Note: ELECTRON_SKIP_BINARY_DOWNLOAD=${env.ELECTRON_SKIP_BINARY_DOWNLOAD} is set in your environment; ignoring it for this download.`);
    delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  }

  // install.js is Electron's own downloader; run it with Node when available, else with the current runtime.
  const node = spawnSync('node', ['--version']).status === 0 ? 'node' : process.execPath;
  const result = spawnSync(node, [join(dir, 'install.js')], { stdio: 'inherit', env });

  if (result.status !== 0 || !installed()) {
    const names = (re) => Object.keys(process.env).filter((k) => re.test(k)).join(', ') || '(none)';
    console.error(
      [
        '',
        'Could not get the Electron binary.',
        `  installer: ${node} ${join(dir, 'install.js')} -> exit ${result.status ?? 'none'}${result.signal ? `, signal ${result.signal}` : ''}${result.error ? `, ${result.error.message}` : ''}`,
        `  expected:  ${join(distDir, existsSync(join(dir, 'path.txt')) ? readFileSync(join(dir, 'path.txt'), 'utf8') : '(path.txt was not created)')}`,
        `  platform:  ${process.platform}/${process.arch}, runtime ${process.version}`,
        `  ELECTRON_* variables set: ${names(/^electron_/i)}`,
        `  proxy variables set:      ${names(/proxy/i)}`,
        '',
        'If the installer printed an error above, that is the cause (usually network, proxy or a blocked download).',
        'To retry from scratch:  rm -rf node_modules/electron && bun install',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log('Electron is ready.');
}
