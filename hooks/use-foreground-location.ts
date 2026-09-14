'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ForegroundLocationController,
  OneShotLocationController,
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
  const [oneShotLocation, setOneShotLocation] =
    useState<ForegroundLocationState>(inactiveLocation);
  const controllerRef = useRef<ForegroundLocationController>(null);
  const oneShotControllerRef = useRef<OneShotLocationController>(null);

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
    const oneShotController = new OneShotLocationController(
      navigator.geolocation,
      setOneShotLocation,
    );
    oneShotControllerRef.current = oneShotController;

    return () => {
      controllerRef.current = null;
      oneShotControllerRef.current = null;
      controller.dispose();
      oneShotController.dispose();
    };
  }, []);

  useEffect(() => {
    oneShotControllerRef.current?.reset();
    controllerRef.current?.setActive(executionActive);
  }, [executionActive]);

  const retryLocation = useCallback(() => {
    if (executionActive) {
      controllerRef.current?.retry();
      return;
    }
    oneShotControllerRef.current?.request();
  }, [executionActive]);

  return {
    location: executionActive ? location : oneShotLocation,
    retryLocation,
  };
}
