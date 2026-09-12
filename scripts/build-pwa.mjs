import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const projectRoot = resolve(import.meta.dirname, '..');
const releaseId = randomUUID();
const vinext = join(projectRoot, 'node_modules', '.bin', 'vinext');
for (const generatedFontDirectory of [
  join(projectRoot, '.vinext', 'fonts'),
  join(projectRoot, 'dist', 'client', '_next', 'static', '_vinext_fonts'),
]) {
  rmSync(generatedFontDirectory, { force: true, recursive: true });
}
const result = spawnSync(vinext, ['build', ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: { ...process.env, ROUTERUNNER_RELEASE_ID: releaseId },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

const clientRoot = join(projectRoot, 'dist', 'client');
const staticRoot = join(clientRoot, '_next', 'static');
const localShellAssets = [
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
];
const assetUrls = [
  ...walkFiles(staticRoot).map(
    (path) => `/${relative(clientRoot, path).split(sep).join('/')}`,
  ),
  ...localShellAssets.map((path) => `/${path}`),
].sort((left, right) => left.localeCompare(right));

await build({
  configFile: false,
  define: {
    __ROUTERUNNER_PRECACHED_URLS__: JSON.stringify(assetUrls),
    __ROUTERUNNER_RELEASE_ID__: JSON.stringify(releaseId),
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: join(projectRoot, 'pwa', 'sw-entry.ts'),
      fileName: () => 'sw.js',
      formats: ['es'],
    },
    minify: false,
    outDir: clientRoot,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  logLevel: 'warn',
});

const verify = spawnSync(
  process.execPath,
  [join(projectRoot, 'scripts', 'verify-pwa-build.mjs')],
  { cwd: projectRoot, stdio: 'inherit' },
);
if (verify.error) throw verify.error;
if (verify.status !== 0) process.exit(verify.status ?? 1);
