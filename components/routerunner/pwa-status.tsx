'use client';

import { useEffect, useState } from 'react';
import {
  pwaNoticeForState,
  pwaStateForInstalledWorker,
  pwaStateForRegistration,
  type PwaState,
} from './pwa-registration-state';

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
      if (cancelled) return;
      setState(
        pwaStateForRegistration(
          registration,
          navigator.serviceWorker.controller !== null,
        ),
      );
    };

    const observeInstalling = (registration: ServiceWorkerRegistration) => {
      observedWorker = registration.installing ?? undefined;
      if (!observedWorker) return;
      observedWorker.addEventListener('statechange', () => {
        if (observedWorker?.state === 'installed') {
          const installedState = pwaStateForInstalledWorker(
            navigator.serviceWorker.controller !== null,
          );
          if (installedState !== 'idle' && !cancelled) {
            setState(installedState);
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

  const notice = pwaNoticeForState(state);
  if (!notice) return null;

  return (
    <output className="pwa-status update-available" aria-live="polite">
      <strong>{notice.title}</strong>
      <span>{notice.detail}</span>
    </output>
  );
}
