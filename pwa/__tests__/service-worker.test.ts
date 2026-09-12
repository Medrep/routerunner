import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  cleanupObsoleteRouteRunnerCaches,
  installRelease,
  isRootDocumentNavigation,
  precachedAssetUrl,
  releaseCacheName,
  rootDocumentRelease,
} from '../service-worker-core.ts';
import {
  authoritativeServiceWorkerRelease,
  verifiedReleaseIdentity,
} from '../build-verification.ts';
import {
  pwaStateForInstalledWorker,
  pwaStateForRegistration,
} from '../../components/routerunner/pwa-registration-state.ts';

class MemoryCache {
  entries = new Map<string, Response>();
  failPutPath?: string;

  async match(request: Request | string) {
    const key = typeof request === 'string' ? request : request.url;
    return this.entries.get(key)?.clone();
  }

  async put(request: Request | string, response: Response) {
    const key = typeof request === 'string' ? request : request.url;
    if (this.failPutPath && new URL(key).pathname === this.failPutPath) {
      throw new Error(`Cache put failed for ${this.failPutPath}.`);
    }
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

void test('root release marker parsing requires exactly one valid authority', () => {
  const marker = (value: string) =>
    `<meta name="routerunner-release" content="${value}">`;

  assert.equal(rootDocumentRelease('<head></head>'), undefined);
  assert.equal(rootDocumentRelease(marker(releaseId)), releaseId);
  assert.equal(rootDocumentRelease(marker('other-release')), 'other-release');
  assert.equal(
    rootDocumentRelease(`${marker(releaseId)}${marker('other-release')}`),
    undefined,
  );
  assert.equal(
    rootDocumentRelease(`${marker('other-release')}${marker(releaseId)}`),
    undefined,
  );
  assert.equal(
    rootDocumentRelease(`${marker(releaseId)}${marker(releaseId)}`),
    undefined,
  );
  assert.equal(
    rootDocumentRelease(
      `<meta name="routerunner-release">${marker(releaseId)}`,
    ),
    undefined,
  );
  assert.equal(
    rootDocumentRelease(
      `<meta name="description" content="unrelated">${marker(releaseId)}`,
    ),
    releaseId,
  );
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
    name: 'conflicting release markers',
    fetcher: async (request: Request) =>
      new URL(request.url).pathname === '/'
        ? new Response(
            `<meta name="routerunner-release" content="${releaseId}"><meta name="routerunner-release" content="other">`,
            { headers: { 'content-type': 'text/html' } },
          )
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

void test('cache.put failure rejects the candidate and preserves the old release', async () => {
  const cacheStorage = new MemoryCacheStorage();
  await cacheStorage.open('routerunner-shell:previous');
  const candidate = await cacheStorage.open(releaseCacheName(releaseId));
  candidate.failPutPath = '/icon-192.png';

  await assert.rejects(
    installRelease({
      assetUrls: assets,
      cacheStorage,
      fetcher: async (request) => responseFor(request),
      origin,
      releaseId,
    }),
    /Cache put failed/,
  );
  assert.deepEqual(await cacheStorage.keys(), ['routerunner-shell:previous']);
});

void test('authoritative generated Service Worker release is singular and exact', () => {
  const declaration = (value: string) =>
    `var ROUTERUNNER_SW_RELEASE_ID = ${JSON.stringify(value)};`;
  const rootHtml = `<meta name="routerunner-release" content="${releaseId}">`;

  assert.equal(authoritativeServiceWorkerRelease(''), undefined);
  assert.equal(
    authoritativeServiceWorkerRelease(declaration(releaseId)),
    releaseId,
  );
  assert.equal(
    authoritativeServiceWorkerRelease(
      `${declaration(releaseId)}\n${declaration('other')}`,
    ),
    undefined,
  );
  assert.equal(
    authoritativeServiceWorkerRelease(
      `${declaration(releaseId)}\n${declaration(releaseId)}`,
    ),
    undefined,
  );
  assert.throws(
    () => verifiedReleaseIdentity(releaseId, rootHtml, ''),
    /Service Worker release/,
  );
  assert.throws(
    () =>
      verifiedReleaseIdentity(
        releaseId,
        rootHtml,
        `${declaration(releaseId)}\n${declaration('other')}`,
      ),
    /Service Worker release/,
  );
  assert.throws(
    () => verifiedReleaseIdentity(releaseId, rootHtml, declaration('other')),
    /Service Worker release/,
  );
  assert.throws(
    () =>
      verifiedReleaseIdentity(
        releaseId,
        '<meta name="routerunner-release" content="other">',
        declaration(releaseId),
      ),
    /Root release marker/,
  );
  assert.deepEqual(
    verifiedReleaseIdentity(releaseId, rootHtml, declaration(releaseId)),
    {
      buildId: releaseId,
      cacheName: releaseCacheName(releaseId),
      rootReleaseId: releaseId,
      serviceWorkerReleaseId: releaseId,
    },
  );
});

void test('client registration states distinguish readiness from a waiting update', () => {
  const worker = (scriptURL: string) => ({ scriptURL }) as ServiceWorker;
  const routeRunnerWorker = worker(`${origin}/sw.js`);
  const unrelatedWorker = worker(`${origin}/other-sw.js`);

  assert.equal(
    pwaStateForRegistration({ active: routeRunnerWorker, waiting: null }, true),
    'offline-ready',
  );
  assert.equal(
    pwaStateForRegistration(
      { active: routeRunnerWorker, waiting: routeRunnerWorker },
      true,
    ),
    'update-available',
  );
  assert.equal(
    pwaStateForRegistration(
      { active: unrelatedWorker, waiting: unrelatedWorker },
      true,
    ),
    'idle',
  );
  assert.equal(pwaStateForInstalledWorker(true), 'update-available');
  assert.equal(pwaStateForInstalledWorker(false), 'idle');
});

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
});
