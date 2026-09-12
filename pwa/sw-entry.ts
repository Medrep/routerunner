import {
  cleanupObsoleteRouteRunnerCaches,
  installRelease,
  isRootDocumentNavigation,
  precachedAssetUrl,
  releaseCacheName,
} from './service-worker-core';

declare const __ROUTERUNNER_PRECACHED_URLS__: readonly string[];
declare const __ROUTERUNNER_RELEASE_ID__: string;

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface ServiceWorkerScopeLike {
  addEventListener(
    type: 'activate' | 'install',
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(
    type: 'fetch',
    listener: (event: FetchEventLike) => void,
  ): void;
  caches: CacheStorage;
  fetch(request: Request): Promise<Response>;
  location: Location;
}

const worker = globalThis as unknown as ServiceWorkerScopeLike;
export const ROUTERUNNER_SW_RELEASE_ID = __ROUTERUNNER_RELEASE_ID__;
const assetUrls = __ROUTERUNNER_PRECACHED_URLS__;
const assetUrlSet = new Set(assetUrls);
const cacheName = releaseCacheName(ROUTERUNNER_SW_RELEASE_ID);
const rootUrl = new URL('/', worker.location.origin).toString();

worker.addEventListener('install', (event) => {
  event.waitUntil(
    installRelease({
      assetUrls,
      cacheStorage: worker.caches,
      fetcher: (request) => worker.fetch(request),
      origin: worker.location.origin,
      releaseId: ROUTERUNNER_SW_RELEASE_ID,
    }),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(cleanupObsoleteRouteRunnerCaches(worker.caches, cacheName));
});

worker.addEventListener('fetch', (event) => {
  if (isRootDocumentNavigation(event.request, worker.location.origin)) {
    event.respondWith(
      worker.caches.open(cacheName).then(async (cache) => {
        const response = await cache.match(rootUrl);
        return response ?? worker.fetch(event.request);
      }),
    );
    return;
  }

  const assetUrl = precachedAssetUrl(
    event.request,
    worker.location.origin,
    assetUrlSet,
  );
  if (assetUrl) {
    event.respondWith(
      worker.caches.open(cacheName).then(async (cache) => {
        const response = await cache.match(
          new URL(assetUrl, rootUrl).toString(),
        );
        return response ?? worker.fetch(event.request);
      }),
    );
  }
});
