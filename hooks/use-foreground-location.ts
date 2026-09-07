'use client';

import { useEffect, useState } from 'react';
import {
  ForegroundLocationController,
  type ForegroundLocationState,
  type VisibilityAdapter,
} from '@/domain';

const inactiveLocation: ForegroundLocationState = { status: 'inactive' };

export function useForegroundLocation(
  executionActive: boolean,
): ForegroundLocationState {
  const [location, setLocation] =
    useState<ForegroundLocationState>(inactiveLocation);

  useEffect(() => {
    const visibility: VisibilityAdapter = {
      isVisible: () => document.visibilityState === 'visible',
      addChangeListener: (listener) =>
        document.addEventListener('visibilitychange', listener),
      removeChangeListener: (listener) =>
        document.removeEventListener('visibilitychange', listener),
    };
    const controller = new ForegroundLocationController(
      navigator.geolocation,
      visibility,
      setLocation,
    );
    controller.setActive(executionActive);

    return () => controller.dispose();
  }, [executionActive]);

  return location;
}
