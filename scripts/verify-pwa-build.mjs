import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifiedReleaseIdentity } from '../pwa/build-verification.ts';

const projectRoot = resolve(import.meta.dirname, '..');
const clientRoot = join(projectRoot, 'dist', 'client');
const serverRoot = join(projectRoot, 'dist', 'server');
const requiredFiles = [
  'sw.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
];

for (const file of requiredFiles) {
  assert.ok(
    existsSync(join(clientRoot, file)),
    `${file} missing from dist/client`,
  );
}

const releaseId = readFileSync(join(serverRoot, 'BUILD_ID'), 'utf8').trim();
const sw = readFileSync(join(clientRoot, 'sw.js'), 'utf8');
assert.doesNotMatch(sw, /skipWaiting|clients\.claim|controllerchange/);
assert.doesNotMatch(sw, /(?:\.env|\.dev\.vars|dist\/server|design-board)/);

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

const staticFiles = walkFiles(join(clientRoot, '_next', 'static'));
const clientJavaScript = staticFiles
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const clientCss = staticFiles
  .filter((file) => file.endsWith('.css'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
assert.deepEqual(
  staticFiles.filter((file) => /\.(?:woff2?|ttf|otf)$/i.test(file)),
  [],
  'unexpected generated font assets remain',
);
for (const file of staticFiles) {
  const url = `/${relative(clientRoot, file).split(sep).join('/')}`;
  assert.ok(sw.includes(JSON.stringify(url)), `sw.js inventory missing ${url}`);
}
for (const tripId of [
  'copenhagen',
  'krk-field06-structured-stop-visit-plan',
  'rome-field-test-2026',
]) {
  assert.ok(
    clientJavaScript.includes(tripId),
    `${tripId} missing from client assets`,
  );
}

const wrangler = JSON.parse(
  readFileSync(join(serverRoot, 'wrangler.json'), 'utf8'),
);
assert.deepEqual(wrangler.d1_databases, []);
assert.deepEqual(wrangler.r2_buckets, []);
assert.deepEqual(wrangler.kv_namespaces, []);

const workerUrl = `${pathToFileURL(join(serverRoot, 'index.js')).href}?verify=${releaseId}`;
const { default: worker } = await import(workerUrl);
const response = await worker.fetch(
  new Request('https://routerunner.build/'),
  {},
  { passThroughOnException() {}, waitUntil() {} },
);
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
const html = await response.text();
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
assert.match(head, /<title>RouteRunner<\/title>/);
assert.match(
  head,
  /<meta name="description" content="Your AI plans\. RouteRunner executes\."\/?>/,
);
assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest"\/?>/);
assert.match(head, /<meta name="theme-color" content="#176b50"\/?>/);
assert.match(
  head,
  /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"\/?>/,
);
assert.match(head, /viewport-fit=cover/);
assert.match(
  head,
  new RegExp(`<meta name="routerunner-release" content="${releaseId}"\\/?>`),
);
const identity = verifiedReleaseIdentity(releaseId, html, sw);
assert.equal(identity.buildId, identity.rootReleaseId);
assert.equal(identity.buildId, identity.serviceWorkerReleaseId);
assert.equal(identity.cacheName, `routerunner-shell:${releaseId}`);
assert.doesNotMatch(
  head,
  /RouteRunner — Copenhagen|Copenhagen day-trip prototype/,
);
assert.doesNotMatch(head, /fonts\.(?:googleapis|gstatic)\.com/i);
assert.doesNotMatch(head, /<link[^>]+rel="stylesheet"[^>]+https?:\/\//i);
assert.doesNotMatch(clientCss, /fonts\.(?:googleapis|gstatic)\.com/i);
assert.doesNotMatch(clientCss, /@font-face/i);
assert.match(
  clientCss,
  /Arial,Helvetica,system-ui,sans-serif/,
  'system font stack missing from final CSS',
);

console.log(`PWA build verified for release ${releaseId}.`);
