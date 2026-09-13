export const ROUTERUNNER_CACHE_PREFIX = 'routerunner-shell:';
export const ROUTERUNNER_RELEASE_HEADER = 'X-RouteRunner-Release';

interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

interface CacheStorageLike {
  delete(cacheName: string): Promise<boolean>;
  keys(): Promise<string[]>;
  open(cacheName: string): Promise<CacheLike>;
}

export interface InstallReleaseOptions {
  assetUrls: readonly string[];
  cacheStorage: CacheStorageLike;
  fetcher: (request: Request) => Promise<Response>;
  origin: string;
  releaseId: string;
}

export function releaseCacheName(releaseId: string): string {
  return `${ROUTERUNNER_CACHE_PREFIX}${releaseId}`;
}

export function isRootDocumentNavigation(
  request: Pick<Request, 'method' | 'mode' | 'url'>,
  origin: string,
): boolean {
  if (request.method !== 'GET' || request.mode !== 'navigate') return false;
  const url = new URL(request.url);
  return url.origin === origin && url.pathname === '/';
}

export function precachedAssetUrl(
  request: Pick<Request, 'method' | 'url'>,
  origin: string,
  assetUrls: ReadonlySet<string>,
): string | undefined {
  if (request.method !== 'GET') return undefined;
  const url = new URL(request.url);
  if (url.origin !== origin) return undefined;
  const key = `${url.pathname}${url.search}`;
  return assetUrls.has(key) ? key : undefined;
}

export async function installRelease({
  assetUrls,
  cacheStorage,
  fetcher,
  origin,
  releaseId,
}: InstallReleaseOptions): Promise<string> {
  const cacheName = releaseCacheName(releaseId);
  const rootUrl = new URL('/', origin).toString();

  try {
    const cache = await cacheStorage.open(cacheName);
    const rootRequest = new Request(rootUrl, {
      cache: 'reload',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' },
    });
    const rootResponse = await fetcher(rootRequest);
    if (!rootResponse.ok) {
      throw new Error(`Root document returned ${rootResponse.status}.`);
    }
    const contentType = rootResponse.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error('Root document is not HTML.');
    }
    if (rootResponse.headers.get(ROUTERUNNER_RELEASE_HEADER) !== releaseId) {
      throw new Error('Root response release does not match service worker.');
    }

    await cache.put(rootRequest, rootResponse.clone());
    await Promise.all(
      assetUrls.map(async (assetUrl) => {
        const request = new Request(new URL(assetUrl, origin), {
          cache: 'reload',
          credentials: 'same-origin',
        });
        const response = await fetcher(request);
        if (!response.ok) {
          throw new Error(`${assetUrl} returned ${response.status}.`);
        }
        await cache.put(request, response);
      }),
    );
    return cacheName;
  } catch (error) {
    await cacheStorage.delete(cacheName);
    throw error;
  }
}

export async function cleanupObsoleteRouteRunnerCaches(
  cacheStorage: CacheStorageLike,
  currentCacheName: string,
): Promise<void> {
  const cacheNames = await cacheStorage.keys();
  await Promise.all(
    cacheNames
      .filter(
        (cacheName) =>
          cacheName.startsWith(ROUTERUNNER_CACHE_PREFIX) &&
          cacheName !== currentCacheName,
      )
      .map((cacheName) => cacheStorage.delete(cacheName)),
  );
}
