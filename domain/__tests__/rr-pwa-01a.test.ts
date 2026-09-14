import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ForegroundLocationController,
  ONE_SHOT_GEOLOCATION_OPTIONS,
  OneShotLocationController,
  createInitialTripExecutionState,
  type ForegroundLocationState,
  type OneShotGeolocationAdapter,
  type VisibilityAdapter,
} from '../index.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  pwaNoticeForState,
  pwaStateForRegistration,
} from '../../components/routerunner/pwa-registration-state.ts';
import {
  activateRouteMapLocation,
  routeMapLocationControlModel,
  shouldCompleteRequestedLocationRecenter,
} from '../../components/routerunner/route-map-location.ts';

const observedAt = '2026-09-14T10:00:00.000Z';

class FakeOneShotGeolocation implements OneShotGeolocationAdapter {
  getCalls = 0;
  watchCalls = 0;
  options: PositionOptions[] = [];
  successes: PositionCallback[] = [];
  failures: Array<PositionErrorCallback | null | undefined> = [];
  watchSuccess?: PositionCallback;
  clearedWatches: number[] = [];

  getCurrentPosition(
    successCallback: PositionCallback,
    errorCallback?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): void {
    this.getCalls += 1;
    this.successes.push(successCallback);
    this.failures.push(errorCallback);
    this.options.push(options ?? {});
  }

  watchPosition(successCallback: PositionCallback): number {
    this.watchCalls += 1;
    this.watchSuccess = successCallback;
    return this.watchCalls;
  }

  clearWatch(watchId: number): void {
    this.clearedWatches.push(watchId);
  }

  sendPosition(
    latitude = 55.6841,
    longitude = 12.593,
    accuracy = 7,
    requestIndex = this.getCalls - 1,
  ): void {
    this.successes[requestIndex]?.({
      coords: {
        latitude,
        longitude,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.parse(observedAt),
      toJSON: () => ({}),
    });
  }

  sendError(
    code: number,
    message: string,
    requestIndex = this.getCalls - 1,
  ): void {
    this.failures[requestIndex]?.({
      code,
      message,
    } as GeolocationPositionError);
  }
}

class VisiblePage implements VisibilityAdapter {
  isVisible(): boolean {
    return true;
  }

  addChangeListener(): void {}

  removeChangeListener(): void {}
}

void test('offline readiness stays internal while update readiness remains actionable', () => {
  const routeRunnerWorker = {
    scriptURL: 'https://routerunner.test/sw.js',
  } as ServiceWorker;

  assert.equal(
    pwaStateForRegistration({ active: routeRunnerWorker, waiting: null }, true),
    'offline-ready',
  );
  assert.equal(pwaNoticeForState('offline-ready'), null);
  assert.deepEqual(pwaNoticeForState('update-available'), {
    title: 'Update available',
    detail: 'Close and reopen RouteRunner when convenient.',
  });

  const statusSource = readFileSync(
    new URL('../../components/routerunner/pwa-status.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(statusSource, /Available offline/);
  assert.match(statusSource, /serviceWorker\s*\.register\('\/sw\.js'/);
  assert.match(statusSource, /updateViaCache: 'none'/);
});

void test('inactive location is acquired only after an explicit one-shot request', () => {
  const geolocation = new FakeOneShotGeolocation();
  const states: ForegroundLocationState[] = [];
  const execution = createInitialTripExecutionState(
    copenhagenTrip,
    '2026-09-14T09:00:00.000Z',
  );
  const executionSnapshot = structuredClone(execution);
  const controller = new OneShotLocationController(
    geolocation,
    (state) => states.push(state),
    () => Date.parse(observedAt),
  );

  assert.equal(geolocation.getCalls, 0);
  assert.equal(geolocation.watchCalls, 0);
  controller.request();
  assert.equal(geolocation.getCalls, 1);
  assert.equal(geolocation.watchCalls, 0);
  assert.deepEqual(geolocation.options, [ONE_SHOT_GEOLOCATION_OPTIONS]);
  assert.deepEqual(states, [{ status: 'locating' }]);

  geolocation.sendPosition();
  assert.deepEqual(states.at(-1), {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 7,
      observedAt,
    },
  });
  assert.deepEqual(execution, executionSnapshot);
  assert.equal(geolocation.watchCalls, 0);
  const controllerSource = readFileSync(
    new URL('../location/one-shot-location.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    controllerSource,
    /watchPosition|localStorage|saveExecution|startDay|Event Log/,
  );
  controller.dispose();
});

void test('one-shot failures are nonfatal and retry only on another action', () => {
  for (const [code, status] of [
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [4, 'error'],
  ] as const) {
    const geolocation = new FakeOneShotGeolocation();
    const states: ForegroundLocationState[] = [];
    const controller = new OneShotLocationController(geolocation, (state) =>
      states.push(state),
    );

    controller.request();
    geolocation.sendError(code, `${status} test`);
    assert.equal(states.at(-1)?.status, status);
    assert.equal(geolocation.getCalls, 1);
    controller.request();
    assert.equal(geolocation.getCalls, 2);
    assert.equal(geolocation.watchCalls, 0);
    controller.dispose();
  }
});

void test('one-shot location is resettable transient presentation state', () => {
  const geolocation = new FakeOneShotGeolocation();
  const states: ForegroundLocationState[] = [];
  const controller = new OneShotLocationController(geolocation, (state) =>
    states.push(state),
  );

  controller.request();
  controller.reset();
  geolocation.sendPosition();
  assert.deepEqual(states, [{ status: 'locating' }, { status: 'inactive' }]);

  controller.request();
  geolocation.sendPosition(55.7, 12.6, 9, 1);
  assert.equal(states.at(-1)?.status, 'available');
  controller.dispose();
});

void test('day start invalidates one-shot GPS before one foreground watch takes authority', () => {
  const geolocation = new FakeOneShotGeolocation();
  const oneShotStates: ForegroundLocationState[] = [];
  const activeStates: ForegroundLocationState[] = [];
  const oneShot = new OneShotLocationController(geolocation, (state) =>
    oneShotStates.push(state),
  );
  const foreground = new ForegroundLocationController(
    geolocation,
    new VisiblePage(),
    (state) => activeStates.push(state),
  );

  oneShot.request();
  assert.equal(geolocation.getCalls, 1);
  assert.equal(geolocation.watchCalls, 0);
  oneShot.reset();
  foreground.setActive(true);
  assert.equal(geolocation.watchCalls, 1);
  assert.deepEqual(activeStates, [{ status: 'locating' }]);

  geolocation.sendPosition();
  assert.deepEqual(oneShotStates, [
    { status: 'locating' },
    { status: 'inactive' },
  ]);
  assert.equal(geolocation.watchCalls, 1);

  foreground.dispose();
  oneShot.dispose();
  assert.deepEqual(geolocation.clearedWatches, [1]);
});

void test('unsupported one-shot location stays compact and explicitly retryable', () => {
  const states: ForegroundLocationState[] = [];
  const controller = new OneShotLocationController(undefined, (state) =>
    states.push(state),
  );
  controller.request();
  assert.equal(states.at(-1)?.status, 'unsupported');
  assert.deepEqual(routeMapLocationControlModel(states.at(-1)!), {
    label: 'Retry',
    disabled: false,
    message: 'Location unsupported',
  });
});

void test('requested acquisition recenters once while later fixes move no camera', () => {
  const firstAvailable: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 7,
      observedAt,
    },
  };
  const laterAvailable: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      ...firstAvailable.coordinates,
      latitude: 55.6842,
      observedAt: '2026-09-14T10:00:10.000Z',
    },
  };
  const easeCalls: unknown[] = [];
  const map = {
    getZoom: () => 12,
    easeTo: (options: unknown) => easeCalls.push(options),
  };

  assert.equal(
    shouldCompleteRequestedLocationRecenter(true, { status: 'locating' }),
    false,
  );
  assert.equal(
    shouldCompleteRequestedLocationRecenter(true, firstAvailable),
    true,
  );
  activateRouteMapLocation(firstAvailable, map, () => assert.fail());
  assert.deepEqual(easeCalls, [
    { center: [12.593, 55.6841], zoom: 14, duration: 500 },
  ]);
  assert.equal(
    shouldCompleteRequestedLocationRecenter(false, laterAvailable),
    false,
  );
  assert.equal(easeCalls.length, 1);
  assert.equal('follow' in (easeCalls[0] as object), false);
});

void test('an available fix waits for a map instead of requesting GPS again', () => {
  const location: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 7,
      observedAt,
    },
  };
  let retryCalls = 0;
  activateRouteMapLocation(location, null, () => {
    retryCalls += 1;
  });
  assert.equal(retryCalls, 0);
});

void test('Day and Full Map expose bounded location controls without accuracy UI', () => {
  const routeMapSource = readFileSync(
    new URL('../../components/routerunner/route-map.tsx', import.meta.url),
    'utf8',
  );
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  );
  const wholeTripMapSource = readFileSync(
    new URL('../../components/routerunner/whole-trip-map.tsx', import.meta.url),
    'utf8',
  );

  assert.match(routeMapSource, /aria-label="My location"/);
  assert.match(routeMapSource, /full \? \(/);
  assert.match(routeMapSource, /<LocateFixed/);
  assert.match(routeMapSource, /aria-busy=/);
  assert.doesNotMatch(routeMapSource, /Location current|accuracy|\u00b1/);
  assert.doesNotMatch(css, /map-location-panel/);
  assert.match(css, /min-width: 44px;[\s\S]*min-height: 44px;/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(pageSource, /Back to day/);
  assert.match(routeMapSource, /syncRouteMapUserMarker/);
  assert.doesNotMatch(wholeTripMapSource, /geolocation|My location/);
});
