import {
  releaseCacheName,
  rootDocumentRelease,
} from './service-worker-core.ts';

const SERVICE_WORKER_RELEASE_DECLARATION =
  /(?:^|\n)var ROUTERUNNER_SW_RELEASE_ID = ("(?:\\.|[^"\\])*");/g;

export function authoritativeServiceWorkerRelease(
  serviceWorkerSource: string,
): string | undefined {
  const declarations = [
    ...serviceWorkerSource.matchAll(SERVICE_WORKER_RELEASE_DECLARATION),
  ];
  if (declarations.length !== 1) return undefined;
  const releaseId = JSON.parse(declarations[0][1]) as unknown;
  return typeof releaseId === 'string' && releaseId.length > 0
    ? releaseId
    : undefined;
}

export function verifiedReleaseIdentity(
  buildId: string,
  rootHtml: string,
  serviceWorkerSource: string,
) {
  if (buildId.length === 0) throw new Error('BUILD_ID is missing.');
  const rootReleaseId = rootDocumentRelease(rootHtml);
  if (rootReleaseId !== buildId) {
    throw new Error('Root release marker does not match BUILD_ID.');
  }
  const serviceWorkerReleaseId =
    authoritativeServiceWorkerRelease(serviceWorkerSource);
  if (serviceWorkerReleaseId !== buildId) {
    throw new Error('Service Worker release does not match BUILD_ID.');
  }
  return {
    buildId,
    cacheName: releaseCacheName(serviceWorkerReleaseId),
    rootReleaseId,
    serviceWorkerReleaseId,
  };
}
