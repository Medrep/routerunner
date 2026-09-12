import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  cleanupObsoleteRouteRunnerCaches,
  installRelease,
  isRootDocumentNavigation,
  precachedAssetUrl,
  releaseCacheName,
} from '../service-worker-core.ts';

class MemoryCache {
  entries = new Map<string, Response>();

  async match(request: Request | string) {
    const key = typeof request === 'string' ? request : request.url;
    return this.entries.get(key)?.clone();
  }

  async put(request: Request | string, response: Response) {
    const key = typeof request === 'string' ? request : request.url;
    this.entries.set(key, response.clone());
  }
}

class MemoryCacheStorage {
  caches = new Map<string, MemoryCache>();

  async delete(cacheName: string) {
    return this.caches.delete(cacheName);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async open(cacheName: string) {
    let cache = this.caches.get(cacheName);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(cacheName, cache);
    }
    return cache;
  }
}

const origin = 'https://routerunner.test';
const releaseId = 'release-under-test';
const assets = ['/_next/static/app.js', '/icon-192.png'];

function responseFor(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (pathname === '/') {
    return new Response(
      `<!doctype html><meta content="${releaseId}" name="routerunner-release"><main>RouteRunner</main>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
  return new Response(`asset:${pathname}`);
}

void test('complete shell installation is release-scoped and atomic', async () => {
  const cacheStorage = new MemoryCacheStorage();
  const cacheName = await installRelease({
    assetUrls: assets,
    cacheStorage,
    fetcher: async (request) => responseFor(request),
    origin,
    releaseId,
  });

  assert.equal(cacheName, releaseCacheName(releaseId));
  const cache = await cacheStorage.open(cacheName);
  assert.ok(await cache.match(`${origin}/`));
  assert.ok(await cache.match(`${origin}/_next/static/app.js`));
  assert.ok(await cache.match(`${origin}/icon-192.png`));
});

for (const scenario of [
  {
    name: 'failed root fetch',
    fetcher: async (request: Request) =>
      new URL(request.url).pathname === '/'
        ? new Response('failure', { status: 503 })
        : responseFor(request),
  },
  {
    name: 'non-HTML root response',
    fetcher: async (request: Request) =>
      new URL(request.url).pathname === '/'
        ? new Response('{}', {
            headers: { 'content-type': 'application/json' },
          })
        : responseFor(request),
  },
  {
    name: 'release marker mismatch',
    fetcher: async (request: Request) =>
      new URL(request.url).pathname === '/'
        ? new Response('<meta name="routerunner-release" content="other">', {
            headers: { 'content-type': 'text/html' },
          })
        : responseFor(request),
  },
  {
    name: 'failed required asset fetch',
    fetcher: async (request: Request) =>
      new URL(request.url).pathname === '/icon-192.png'
        ? new Response('failure', { status: 404 })
        : responseFor(request),
  },
]) {
  void test(`${scenario.name} rejects the new install and preserves the old release`, async () => {
    const cacheStorage = new MemoryCacheStorage();
    await cacheStorage.open('routerunner-shell:previous');
    await assert.rejects(
      installRelease({
        assetUrls: assets,
        cacheStorage,
        fetcher: scenario.fetcher,
        origin,
        releaseId,
      }),
    );
    assert.deepEqual(await cacheStorage.keys(), ['routerunner-shell:previous']);
  });
}

void test('fetch routing handles only root documents and exact local inventory assets', () => {
  const assetSet = new Set(assets);
  const navigation = (url: string, mode: RequestMode = 'navigate') => ({
    method: 'GET',
    mode,
    url,
  });

  assert.equal(
    isRootDocumentNavigation(navigation(`${origin}/`), origin),
    true,
  );
  assert.equal(
    isRootDocumentNavigation(
      navigation(`${origin}/?trip=rome-field-test-2026`),
      origin,
    ),
    true,
  );
  assert.equal(
    isRootDocumentNavigation(
      navigation(`${origin}/?trip=krk-field06-structured-stop-visit-plan`),
      origin,
    ),
    true,
  );
  assert.equal(
    isRootDocumentNavigation(navigation(`${origin}/`, 'cors'), origin),
    false,
    'RSC/fetch requests must remain network-owned',
  );
  assert.equal(
    isRootDocumentNavigation(
      navigation(`${origin}/_next/static/app.js`, 'cors'),
      origin,
    ),
    false,
  );
  assert.equal(
    precachedAssetUrl(
      navigation(`${origin}/_next/static/app.js`, 'cors'),
      origin,
      assetSet,
    ),
    '/_next/static/app.js',
  );
  assert.equal(
    precachedAssetUrl(
      navigation(`${origin}/api/trips`, 'cors'),
      origin,
      assetSet,
    ),
    undefined,
  );
  assert.equal(
    precachedAssetUrl(
      navigation('https://api.mapbox.com/styles/v1/example', 'cors'),
      origin,
      assetSet,
    ),
    undefined,
  );
  assert.equal(
    precachedAssetUrl(
      navigation('https://www.google.com/maps/dir/', 'navigate'),
      origin,
      assetSet,
    ),
    undefined,
  );
});

void test('activation removes only obsolete RouteRunner caches', async () => {
  const cacheStorage = new MemoryCacheStorage();
  await cacheStorage.open('routerunner-shell:old');
  await cacheStorage.open('routerunner-shell:current');
  await cacheStorage.open('another-app:cache');

  await cleanupObsoleteRouteRunnerCaches(
    cacheStorage,
    'routerunner-shell:current',
  );
  assert.deepEqual((await cacheStorage.keys()).sort(), [
    'another-app:cache',
    'routerunner-shell:current',
  ]);
});

void test('update lifecycle contains no forced takeover or reload', () => {
  const swSource = readFileSync(
    new URL('../sw-entry.ts', import.meta.url),
    'utf8',
  );
  const registrationSource = readFileSync(
    new URL('../../components/routerunner/pwa-status.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(swSource, /skipWaiting|clients\.claim/);
  assert.doesNotMatch(registrationSource, /controllerchange|location\.reload/);
  assert.match(registrationSource, /registration\.waiting/);
  assert.match(registrationSource, /update-available/);
});
