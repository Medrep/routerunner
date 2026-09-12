'use client';

import { useEffect, useState } from 'react';

type PwaState = 'idle' | 'offline-ready' | 'update-available';

function isRouteRunnerWorker(registration: ServiceWorkerRegistration) {
  const worker = registration.waiting ?? registration.active;
  return worker ? new URL(worker.scriptURL).pathname === '/sw.js' : false;
}

export function PwaStatus() {
  const [state, setState] = useState<PwaState>('idle');

  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }

    let cancelled = false;
    let observedWorker: ServiceWorker | undefined;

    const reportRegistration = (registration: ServiceWorkerRegistration) => {
      if (cancelled || !isRouteRunnerWorker(registration)) return;
      if (registration.waiting && navigator.serviceWorker.controller) {
        setState('update-available');
      } else if (registration.active) {
        setState('offline-ready');
      }
    };

    const observeInstalling = (registration: ServiceWorkerRegistration) => {
      observedWorker = registration.installing ?? undefined;
      if (!observedWorker) return;
      observedWorker.addEventListener('statechange', () => {
        if (observedWorker?.state === 'installed') {
          if (navigator.serviceWorker.controller && !cancelled) {
            setState('update-available');
          } else {
            reportRegistration(registration);
          }
        }
        if (
          observedWorker?.state === 'activated' &&
          !registration.waiting &&
          !cancelled
        ) {
          setState('offline-ready');
        }
      });
    };

    void navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        type: 'module',
        updateViaCache: 'none',
      })
      .then((registration) => {
        if (cancelled) return;
        reportRegistration(registration);
        observeInstalling(registration);
        registration.addEventListener('updatefound', () => {
          observeInstalling(registration);
        });
        return navigator.serviceWorker.ready;
      })
      .then((registration) => {
        if (registration) reportRegistration(registration);
      })
      .catch(() => {
        // PWA preparation is an enhancement; online execution stays available.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'idle') return null;

  return (
    <output className={`pwa-status ${state}`} aria-live="polite">
      {state === 'offline-ready' ? (
        'Available offline'
      ) : (
        <>
          <strong>Update available</strong>
          <span>Close and reopen RouteRunner when convenient.</span>
        </>
      )}
    </output>
  );
}
