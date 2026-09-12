import {
  releaseCacheName,
  rootDocumentRelease,
} from './service-worker-core.ts';

const SERVICE_WORKER_RELEASE_BOOTSTRAP =
  'self.__ROUTERUNNER_SW_RELEASE_ID__ = ';

export function serviceWorkerReleaseBootstrap(releaseId: string): string {
  if (releaseId.length === 0)
    throw new Error('Service Worker release is empty.');
  return `${SERVICE_WORKER_RELEASE_BOOTSTRAP}${JSON.stringify(releaseId)};\n`;
}

export function authoritativeServiceWorkerRelease(
  serviceWorkerSource: string,
): string | undefined {
  if (!serviceWorkerSource.startsWith(SERVICE_WORKER_RELEASE_BOOTSTRAP)) {
    return undefined;
  }

  const valueStart = SERVICE_WORKER_RELEASE_BOOTSTRAP.length;
  if (serviceWorkerSource[valueStart] !== '"') return undefined;
  let escaped = false;
  let valueEnd = -1;
  for (
    let cursor = valueStart + 1;
    cursor < serviceWorkerSource.length;
    cursor += 1
  ) {
    const character = serviceWorkerSource[cursor];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      valueEnd = cursor + 1;
      break;
    } else if (character.charCodeAt(0) < 32) {
      return undefined;
    }
  }
  if (
    valueEnd === -1 ||
    serviceWorkerSource.slice(valueEnd, valueEnd + 2) !== ';\n'
  ) {
    return undefined;
  }

  const encodedRelease = serviceWorkerSource.slice(valueStart, valueEnd);
  try {
    const releaseId = JSON.parse(encodedRelease) as unknown;
    return typeof releaseId === 'string' &&
      releaseId.length > 0 &&
      JSON.stringify(releaseId) === encodedRelease
      ? releaseId
      : undefined;
  } catch {
    return undefined;
  }
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
