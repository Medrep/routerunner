'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ForegroundLocationController,
  type ForegroundLocationState,
  type VisibilityAdapter,
} from '@/domain';

const inactiveLocation: ForegroundLocationState = { status: 'inactive' };

export function useForegroundLocation(executionActive: boolean): {
  location: ForegroundLocationState;
  retryLocation: () => void;
} {
  const [location, setLocation] =
    useState<ForegroundLocationState>(inactiveLocation);
  const controllerRef = useRef<ForegroundLocationController>(null);

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
    controllerRef.current = controller;

    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setActive(executionActive);
  }, [executionActive]);

  const retryLocation = useCallback(() => {
    controllerRef.current?.retry();
  }, []);

  return {
    location: executionActive ? location : inactiveLocation,
    retryLocation,
  };
}
