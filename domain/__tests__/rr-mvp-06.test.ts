import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FOREGROUND_GEOLOCATION_OPTIONS,
  FOREGROUND_LOCATION_FRESHNESS_MS,
  ForegroundLocationController,
  buildGoogleMapsNavigationUrl,
  createInitialTripExecutionState,
  currentGoogleMapsNavigationUrl,
  deriveRouteMapView,
  executionStorageKey,
  googleMapsTravelMode,
  mapGeolocationError,
  mapboxTokenState,
  projectSchedule,
  startDay,
  startDayAndBuildNavigation,
  type ForegroundLocationState,
  type ForegroundLocationTimerAdapter,
  type GeolocationAdapter,
  type Trip,
  type TripExecutionState,
  type VisibilityAdapter,
} from '../index.ts';
import {
  copenhagenAirport,
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  activateRouteMapLocation,
  syncRouteMapUserMarker,
} from '../../components/routerunner/route-map-location.ts';

const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:05:00.000Z';

class FakeVisibility implements VisibilityAdapter {
  visible = true;
  listeners = new Set<() => void>();

  isVisible() {
    return this.visible;
  }

  addChangeListener(listener: () => void) {
    this.listeners.add(listener);
  }

  removeChangeListener(listener: () => void) {
    this.listeners.delete(listener);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    for (const listener of this.listeners) listener();
  }
}

class FakeGeolocation implements GeolocationAdapter {
  watchCalls = 0;
  cleared: number[] = [];
  liveWatchIds = new Set<number>();
  options: PositionOptions[] = [];
  success?: PositionCallback;
  failure?: PositionErrorCallback | null;
  callbacks = new Map<
    number,
    { success: PositionCallback; failure?: PositionErrorCallback | null }
  >();

  watchPosition(
    successCallback: PositionCallback,
    errorCallback?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number {
    this.watchCalls += 1;
    this.success = successCallback;
    this.failure = errorCallback;
    this.options.push(options ?? {});
    this.liveWatchIds.add(this.watchCalls);
    this.callbacks.set(this.watchCalls, {
      success: successCallback,
      failure: errorCallback,
    });
    return this.watchCalls;
  }

  clearWatch(watchId: number): void {
    this.cleared.push(watchId);
    this.liveWatchIds.delete(watchId);
  }

  sendPosition(
    latitude: number,
    longitude: number,
    accuracy: number,
    timestamp: number,
    watchId = this.watchCalls,
  ) {
    this.callbacks.get(watchId)?.success({
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
      timestamp,
      toJSON: () => ({}),
    });
  }

  sendError(code: number, message: string, watchId = this.watchCalls): void {
    this.callbacks.get(watchId)?.failure?.({
      code,
      message,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
  }
}

class FakeClock implements ForegroundLocationTimerAdapter {
  now = Date.parse(startedAt);
  lastTimerId: number | undefined;
  private nextTimerId = 1;
  private readonly callbacks = new Map<number, () => void>();
  private readonly timers = new Map<
    number,
    { dueAt: number; callback: () => void }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const timerId = this.nextTimerId++;
    this.lastTimerId = timerId;
    this.callbacks.set(timerId, callback);
    this.timers.set(timerId, { dueAt: this.now + delayMs, callback });
    return timerId;
  }

  clearTimeout(timerId: unknown): void {
    if (typeof timerId === 'number') this.timers.delete(timerId);
  }

  advance(milliseconds: number): void {
    this.now += milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }

  forceClearedTimer(timerId: number): void {
    this.callbacks.get(timerId)?.();
  }

  get pendingTimerCount(): number {
    return this.timers.size;
  }
}

class FakeMapMarker {
  removed = 0;
  coordinates: [number, number][];

  constructor(initialCoordinates: [number, number]) {
    this.coordinates = [initialCoordinates];
  }

  setLngLat(coordinates: [number, number]): this {
    this.coordinates.push(coordinates);
    return this;
  }

  remove(): void {
    this.removed += 1;
  }
}

class FakeLocationCamera {
  readonly easeCalls: Array<{
    center: [number, number];
    zoom: number;
    duration: number;
  }> = [];

  getZoom(): number {
    return 12;
  }

  easeTo(options: {
    center: [number, number];
    zoom: number;
    duration: number;
  }): void {
    this.easeCalls.push(options);
  }
}

function collectLocationController(
  geolocation: GeolocationAdapter | undefined,
  visibility = new FakeVisibility(),
  clock = new FakeClock(),
) {
  const states: ForegroundLocationState[] = [];
  const controller = new ForegroundLocationController(
    geolocation,
    visibility,
    (state) => states.push(state),
    () => clock.now,
    clock,
  );
  return { controller, states, visibility, clock };
}

function initialState(trip: Trip = copenhagenTrip) {
  return createInitialTripExecutionState(trip, initializedAt);
}

function activeState(trip: Trip = copenhagenTrip) {
  const result = startDay(trip, initialState(trip), trip.days[0].id, startedAt);
  assert.equal(result.ok, true);
  return result.state;
}

void test('unsupported geolocation maps to a deterministic nonfatal state', () => {
  const { controller, states } = collectLocationController(undefined);
  controller.setActive(true);
  assert.deepEqual(states.at(-1), {
    status: 'unsupported',
    message: 'Browser geolocation is unavailable.',
  });
  controller.dispose();
});

void test('tracking starts only for an active execution on a visible page', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states } = collectLocationController(geolocation);
  assert.equal(geolocation.watchCalls, 0);
  assert.deepEqual(states, []);
  controller.setActive(true);
  assert.equal(geolocation.watchCalls, 1);
  assert.deepEqual(states.at(-1), { status: 'locating' });
  assert.deepEqual(geolocation.options, [FOREGROUND_GEOLOCATION_OPTIONS]);
  controller.dispose();
});

void test('repeated reconciliation never creates a duplicate watch', () => {
  const geolocation = new FakeGeolocation();
  const { controller, visibility } = collectLocationController(geolocation);
  controller.setActive(true);
  controller.setActive(true);
  visibility.setVisible(true);
  assert.equal(geolocation.watchCalls, 1);
  assert.equal(visibility.listeners.size, 1);
  controller.dispose();
  assert.equal(visibility.listeners.size, 0);
});

void test('a hidden page defers tracking until it becomes visible', () => {
  const geolocation = new FakeGeolocation();
  const visibility = new FakeVisibility();
  visibility.visible = false;
  const { controller } = collectLocationController(geolocation, visibility);
  controller.setActive(true);
  assert.equal(geolocation.watchCalls, 0);
  visibility.setVisible(true);
  assert.equal(geolocation.watchCalls, 1);
  controller.dispose();
});

void test('successful positions map coordinates, accuracy and observedAt', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8.4, Date.parse(startedAt));
  assert.deepEqual(states.at(-1), {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 8.4,
      observedAt: startedAt,
    },
  });
  controller.dispose();
});

void test('browser geolocation errors map deterministically', () => {
  assert.equal(mapGeolocationError({ code: 1, message: '' }).status, 'denied');
  assert.equal(
    mapGeolocationError({ code: 2, message: '' }).status,
    'unavailable',
  );
  assert.equal(mapGeolocationError({ code: 3, message: '' }).status, 'timeout');
  assert.equal(mapGeolocationError({ code: 99, message: '' }).status, 'error');
});

void test('hidden visibility clears the watch and visible restarts it', () => {
  const geolocation = new FakeGeolocation();
  const { controller, visibility } = collectLocationController(geolocation);
  controller.setActive(true);
  visibility.setVisible(false);
  assert.deepEqual(geolocation.cleared, [1]);
  visibility.setVisible(true);
  assert.equal(geolocation.watchCalls, 2);
  controller.dispose();
  assert.deepEqual(geolocation.cleared, [1, 2]);
});

void test('hidden visibility immediately removes an available fix', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, visibility, clock } =
    collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 6, clock.now);
  assert.equal(states.at(-1)?.status, 'available');

  visibility.setVisible(false);

  assert.deepEqual(states.at(-1), { status: 'inactive' });
  assert.equal(clock.pendingTimerCount, 0);
  controller.dispose();
});

void test('deactivation and disposal clear active location watches', () => {
  const geolocation = new FakeGeolocation();
  const { controller } = collectLocationController(geolocation);
  controller.setActive(true);
  controller.setActive(false);
  assert.deepEqual(geolocation.cleared, [1]);
  controller.setActive(true);
  controller.dispose();
  assert.deepEqual(geolocation.cleared, [1, 2]);
});

void test('deactivation immediately removes an available fix and its timer', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 6, clock.now);
  assert.equal(clock.pendingTimerCount, 1);

  controller.setActive(false);

  assert.deepEqual(states.at(-1), { status: 'inactive' });
  assert.equal(clock.pendingTimerCount, 0);
  controller.dispose();
});

void test('a silent successful fix expires just after the 60 second threshold', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);

  clock.advance(FOREGROUND_LOCATION_FRESHNESS_MS);
  assert.equal(states.at(-1)?.status, 'available');
  clock.advance(1);

  assert.deepEqual(states.at(-1), {
    status: 'stale',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 8,
      observedAt: startedAt,
    },
  });
  assert.equal(clock.pendingTimerCount, 0);
  controller.dispose();
});

void test('a newer fix replaces the stale timer without accumulating timers', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);
  clock.advance(10_000);
  geolocation.sendPosition(55.6842, 12.5931, 7, clock.now);

  assert.equal(clock.pendingTimerCount, 1);
  clock.advance(FOREGROUND_LOCATION_FRESHNESS_MS + 1);
  assert.equal(states.at(-1)?.status, 'stale');
  controller.dispose();
});

void test('disposal clears the stale timer', () => {
  const geolocation = new FakeGeolocation();
  const { controller, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);
  assert.equal(clock.pendingTimerCount, 1);
  controller.dispose();
  assert.equal(clock.pendingTimerCount, 0);
});

void test('identical fixes do not publish or reschedule redundant state', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);
  const stateCount = states.length;
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);
  assert.equal(states.length, stateCount);
  assert.equal(clock.pendingTimerCount, 1);
  controller.dispose();
});

void test('a stationary newer-timestamp fix renews freshness and rejects the old timer', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);
  const firstTimerId = clock.lastTimerId;
  assert.ok(firstTimerId);

  clock.advance(10_000);
  const renewedAt = new Date(clock.now).toISOString();
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);

  const renewedState = states.at(-1);
  assert.equal(renewedState?.status, 'available');
  assert.equal(
    renewedState?.status === 'available'
      ? renewedState.coordinates.observedAt
      : undefined,
    renewedAt,
  );
  assert.equal(clock.pendingTimerCount, 1);

  clock.forceClearedTimer(firstTimerId);
  assert.equal(states.at(-1)?.status, 'available');
  clock.advance(FOREGROUND_LOCATION_FRESHNESS_MS);
  assert.equal(states.at(-1)?.status, 'available');
  clock.advance(1);
  assert.equal(states.at(-1)?.status, 'stale');
  controller.dispose();
});

void test('rapid repeated Retry keeps only the latest watch and callbacks authoritative', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, visibility, clock } =
    collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendError(2, 'temporarily unavailable', 1);

  controller.retry();
  controller.retry();
  controller.retry();

  assert.deepEqual(geolocation.cleared, [1, 2, 3]);
  assert.deepEqual([...geolocation.liveWatchIds], [4]);
  assert.equal(visibility.listeners.size, 1);
  assert.deepEqual(states.at(-1), { status: 'locating' });

  geolocation.sendPosition(55.6844, 12.5934, 5, clock.now, 4);
  const authoritative = states.at(-1);
  const stateCount = states.length;
  geolocation.sendPosition(40.7128, -74.006, 50, clock.now, 2);
  geolocation.sendError(3, 'late timeout', 3);

  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), authoritative);
  assert.deepEqual([...geolocation.liveWatchIds], [4]);
  controller.dispose();
});

void test('late success and error from a failed pre-Retry watch cannot overwrite its replacement', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendError(2, 'temporarily unavailable', 1);
  controller.retry();
  geolocation.sendPosition(55.6845, 12.5935, 4, clock.now, 2);
  const authoritative = states.at(-1);
  const stateCount = states.length;

  geolocation.sendPosition(34.0522, -118.2437, 80, clock.now, 1);
  geolocation.sendError(3, 'late timeout', 1);

  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), authoritative);
  assert.deepEqual([...geolocation.liveWatchIds], [2]);
  controller.dispose();
});

void test('late callbacks cannot resurrect a deactivated then reactivated generation', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now, 1);
  controller.setActive(false);
  controller.setActive(true);
  geolocation.sendPosition(55.6846, 12.5936, 3, clock.now, 2);
  const authoritative = states.at(-1);
  const stateCount = states.length;

  geolocation.sendPosition(51.5072, -0.1276, 90, clock.now, 1);
  geolocation.sendError(2, 'late unavailable', 1);

  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), authoritative);
  assert.deepEqual([...geolocation.liveWatchIds], [2]);
  controller.dispose();
});

void test('a cleared stale timer firing late cannot change inactive state', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendPosition(55.6841, 12.593, 8, clock.now);
  const staleTimerId = clock.lastTimerId;
  assert.ok(staleTimerId);

  controller.setActive(false);
  assert.equal(clock.pendingTimerCount, 0);
  const inactiveStateCount = states.length;
  clock.forceClearedTimer(staleTimerId);

  assert.equal(states.length, inactiveStateCount);
  assert.deepEqual(states.at(-1), { status: 'inactive' });
  controller.dispose();
});

for (const [code, status] of [
  [2, 'unavailable'],
  [3, 'timeout'],
] as const) {
  void test(`${status} stops tracking and explicit retry starts one watch`, () => {
    const geolocation = new FakeGeolocation();
    const { controller, states } = collectLocationController(geolocation);
    controller.setActive(true);
    geolocation.sendError(code, status);
    assert.equal(states.at(-1)?.status, status);
    assert.deepEqual(geolocation.cleared, [1]);

    controller.retry();

    assert.equal(geolocation.watchCalls, 2);
    assert.deepEqual(states.at(-1), { status: 'locating' });
    controller.dispose();
  });
}

void test('permission denial never retries without direct user action', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, clock } = collectLocationController(geolocation);
  controller.setActive(true);
  geolocation.sendError(1, 'denied');
  clock.advance(FOREGROUND_LOCATION_FRESHNESS_MS * 2);
  assert.equal(states.at(-1)?.status, 'denied');
  assert.equal(geolocation.watchCalls, 1);

  controller.retry();
  assert.equal(geolocation.watchCalls, 2);
  controller.dispose();
});

void test('retry is inert while hidden or execution-inactive', () => {
  const geolocation = new FakeGeolocation();
  const { controller, visibility } = collectLocationController(geolocation);
  controller.retry();
  assert.equal(geolocation.watchCalls, 0);
  controller.setActive(true);
  visibility.setVisible(false);
  controller.retry();
  assert.equal(geolocation.watchCalls, 1);
  controller.dispose();
});

void test('stale error cannot alter state or clear a replacement watch', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, visibility } =
    collectLocationController(geolocation);
  controller.setActive(true);
  visibility.setVisible(false);
  visibility.setVisible(true);
  geolocation.sendPosition(55.6841, 12.593, 6, Date.parse(startedAt), 2);
  const stateCount = states.length;

  geolocation.sendError(2, 'stale position unavailable', 1);

  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 6,
      observedAt: startedAt,
    },
  });
  assert.deepEqual(geolocation.cleared, [1]);
  controller.dispose();
  assert.deepEqual(geolocation.cleared, [1, 2]);
});

void test('stale success cannot overwrite a newer watch position', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, visibility } =
    collectLocationController(geolocation);
  controller.setActive(true);
  visibility.setVisible(false);
  visibility.setVisible(true);
  geolocation.sendPosition(55.6841, 12.593, 5, Date.parse(startedAt), 2);
  const authoritative = states.at(-1);
  const stateCount = states.length;

  geolocation.sendPosition(55.6797, 12.5909, 20, Date.parse(initializedAt), 1);

  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), authoritative);
  controller.dispose();
});

void test('success retained after disposal is inert', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states } = collectLocationController(geolocation);
  controller.setActive(true);
  controller.dispose();
  const stateCount = states.length;

  geolocation.sendPosition(55.6841, 12.593, 5, Date.parse(startedAt), 1);

  assert.equal(states.length, stateCount);
  assert.equal(
    states.some((state) => state.status === 'available'),
    false,
  );
  assert.deepEqual(geolocation.cleared, [1]);
});

void test('error retained after disposal is inert', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states } = collectLocationController(geolocation);
  controller.setActive(true);
  controller.dispose();
  const stateCount = states.length;

  geolocation.sendError(1, 'stale permission denial', 1);

  assert.equal(states.length, stateCount);
  assert.equal(
    states.some((state) => state.status === 'denied'),
    false,
  );
  assert.deepEqual(geolocation.cleared, [1]);
});

void test('callbacks retained after page-hidden invalidation are inert', () => {
  const geolocation = new FakeGeolocation();
  const { controller, states, visibility } =
    collectLocationController(geolocation);
  controller.setActive(true);
  visibility.setVisible(false);
  const hiddenState = states.at(-1);
  const stateCount = states.length;

  geolocation.sendPosition(55.6841, 12.593, 5, Date.parse(startedAt), 1);
  geolocation.sendError(2, 'stale hidden error', 1);

  assert.equal(states.length, stateCount);
  assert.deepEqual(states.at(-1), hiddenState);
  assert.deepEqual(geolocation.cleared, [1]);
  controller.dispose();
});

void test('GPS updates remain separate from execution and use a distinct map field', () => {
  const execution = activeState();
  const before = structuredClone(execution);
  const userLocation = {
    latitude: 55.6841,
    longitude: 12.593,
    accuracy: 7,
    observedAt: startedAt,
  };
  const view = deriveRouteMapView(copenhagenTrip, execution, userLocation);
  const scheduleBefore = projectSchedule(copenhagenTrip, execution, startedAt);
  const scheduleAfter = projectSchedule(copenhagenTrip, execution, startedAt);
  assert.equal(execution.currentStopId, copenhagenStopIds.nyhavn);
  assert.deepEqual(execution, before);
  assert.deepEqual(view.userLocation, userLocation);
  assert.equal(
    view.stops.find((stop) => stop.status === 'current')?.stopId,
    copenhagenStopIds.nyhavn,
  );
  assert.equal(
    view.stops.some(
      (stop) =>
        stop.latitude === userLocation.latitude &&
        stop.longitude === userLocation.longitude &&
        stop.stopId !== copenhagenStopIds.amalienborg,
    ),
    false,
  );
  assert.equal(execution.eventLog.length, before.eventLog.length);
  assert.equal(execution.currentStopId, before.currentStopId);
  assert.equal(execution.executionDayId, before.executionDayId);
  assert.deepEqual(scheduleAfter, scheduleBefore);
  assert.equal(JSON.stringify(execution).includes('55.6841'), false);
});

void test('the hook owns one controller and immediately masks ineligible presentation', () => {
  const hookSource = readFileSync(
    new URL('../../hooks/use-foreground-location.ts', import.meta.url),
    'utf8',
  );

  assert.equal(
    hookSource.match(/new ForegroundLocationController\(/g)?.length,
    1,
  );
  assert.match(
    hookSource,
    /controllerRef\.current\?\.setActive\(executionActive\)/,
  );
  assert.match(
    hookSource,
    /location: executionActive \? location : inactiveLocation/,
  );
  assert.match(hookSource, /controllerRef\.current\?\.retry\(\)/);
});

void test('a location-only runtime update retains map, Stop and Via marker instances', () => {
  const map = { identity: 'retained-map' };
  const mapRef = { current: map };
  const stopMarker = { identity: 'stop-marker' };
  const viaMarker = { identity: 'via-marker' };
  const stopMarkers = new Map([['stop-1', stopMarker]]);
  const viaMarkers = new Map([[0, viaMarker]]);
  const stopMarkersRef = stopMarkers;
  const viaMarkersRef = viaMarkers;
  let createCalls = 0;
  const createMarker = (
    receivedMap: typeof map,
    coordinates: [number, number],
  ) => {
    assert.strictEqual(receivedMap, map);
    createCalls += 1;
    return new FakeMapMarker(coordinates);
  };
  const firstLocation: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 8,
      observedAt: startedAt,
    },
  };
  const secondLocation: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6842,
      longitude: 12.5931,
      accuracy: 7,
      observedAt: '2026-09-08T08:05:10.000Z',
    },
  };

  const userMarker = syncRouteMapUserMarker(
    mapRef.current,
    firstLocation,
    null,
    createMarker,
  );
  assert.ok(userMarker);
  const updatedUserMarker = syncRouteMapUserMarker(
    mapRef.current,
    secondLocation,
    userMarker,
    createMarker,
  );

  assert.strictEqual(mapRef.current, map);
  assert.strictEqual(stopMarkers, stopMarkersRef);
  assert.strictEqual(viaMarkers, viaMarkersRef);
  assert.strictEqual(stopMarkers.get('stop-1'), stopMarker);
  assert.strictEqual(viaMarkers.get(0), viaMarker);
  assert.strictEqual(updatedUserMarker, userMarker);
  assert.equal(createCalls, 1);
  assert.deepEqual(userMarker.coordinates, [
    [12.593, 55.6841],
    [12.5931, 55.6842],
  ]);
  assert.equal(userMarker.removed, 0);
});

void test('GPS updates move only the marker while My location clicks alone recenter', () => {
  const map = new FakeLocationCamera();
  const marker = new FakeMapMarker([12.593, 55.6841]);
  const createMarker = () => marker;
  let retryCalls = 0;
  const firstLocation: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6841,
      longitude: 12.593,
      accuracy: 8,
      observedAt: startedAt,
    },
  };
  const secondLocation: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6843,
      longitude: 12.5933,
      accuracy: 6,
      observedAt: '2026-09-08T08:05:10.000Z',
    },
  };

  syncRouteMapUserMarker(map, firstLocation, marker, createMarker);
  syncRouteMapUserMarker(map, secondLocation, marker, createMarker);
  assert.equal(map.easeCalls.length, 0);

  activateRouteMapLocation(secondLocation, map, () => {
    retryCalls += 1;
  });
  assert.deepEqual(map.easeCalls, [
    { center: [12.5933, 55.6843], zoom: 14, duration: 500 },
  ]);

  const thirdLocation: ForegroundLocationState = {
    status: 'available',
    coordinates: {
      latitude: 55.6844,
      longitude: 12.5934,
      accuracy: 5,
      observedAt: '2026-09-08T08:05:20.000Z',
    },
  };
  syncRouteMapUserMarker(map, thirdLocation, marker, createMarker);
  assert.equal(map.easeCalls.length, 1);

  activateRouteMapLocation(thirdLocation, map, () => {
    retryCalls += 1;
  });
  assert.equal(map.easeCalls.length, 2);
  assert.deepEqual(map.easeCalls[1], {
    center: [12.5934, 55.6844],
    zoom: 14,
    duration: 500,
  });
  assert.equal(retryCalls, 0);

  activateRouteMapLocation(
    { status: 'timeout', message: 'timed out' },
    map,
    () => {
      retryCalls += 1;
    },
  );
  assert.equal(retryCalls, 1);
  assert.equal(map.easeCalls.length, 2);
});

void test('Day and Full Map share fresh-only location presentation and one-shot camera control', () => {
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
  const locationHelperSource = readFileSync(
    new URL(
      '../../components/routerunner/route-map-location.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const mapLocationSource = `${routeMapSource}\n${locationHelperSource}`;

  assert.match(locationHelperSource, /location\.status !== 'available'/);
  assert.match(locationHelperSource, /marker\.setLngLat/);
  assert.match(routeMapSource, /syncRouteMapUserMarker/);
  assert.match(routeMapSource, /aria-label="Show my location"/);
  assert.match(locationHelperSource, /map\.easeTo\(/);
  assert.equal(mapLocationSource.match(/map\.easeTo\(/g)?.length, 1);
  assert.match(routeMapSource, /Location outdated/);
  assert.match(routeMapSource, /Retry location/);
  assert.match(routeMapSource, /full && runtimeError/);
  assert.match(css, /\.mapbox-user-marker[\s\S]*background: #2678b4/);
  assert.match(css, /\.map-location-panel/);
  assert.equal(pageSource.match(/<RouteMap/g)?.length, 2);
  assert.equal(pageSource.match(/location=\{location\}/g)?.length, 2);
  assert.equal(
    pageSource.match(/onRetryLocation=\{retryLocation\}/g)?.length,
    2,
  );
  assert.doesNotMatch(routeMapSource, /follow|heading-up|breadcrumb/i);
  assert.doesNotMatch(routeMapSource, /FIELD-10B|instructional overlay/i);
});

void test('GPS stays outside planned bounds, Whole Trip Map and map derivation updates', () => {
  const execution = activeState();
  const userLocation = {
    latitude: -33.8688,
    longitude: 151.2093,
    accuracy: 12,
    observedAt: startedAt,
  };
  const withoutLocation = deriveRouteMapView(copenhagenTrip, execution);
  const withLocation = deriveRouteMapView(
    copenhagenTrip,
    execution,
    userLocation,
  );
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  const wholeTripSource = readFileSync(
    new URL('../../components/routerunner/whole-trip-map.tsx', import.meta.url),
    'utf8',
  );

  assert.deepEqual(
    withLocation.initialBoundsCoordinates,
    withoutLocation.initialBoundsCoordinates,
  );
  assert.match(pageSource, /deriveWholeTripMapView\(trip, execution\)/);
  assert.doesNotMatch(wholeTripSource, /ForegroundLocation|userLocation/);
  assert.doesNotMatch(
    pageSource,
    /deriveRouteMapView\(trip, execution,\s*(?:coordinates|location)/,
  );
});

void test('map view uses DayPlanItem.order and StopId-derived statuses', () => {
  const trip = {
    ...copenhagenTrip,
    stops: [...copenhagenTrip.stops].reverse(),
    days: [
      {
        ...copenhagenTrip.days[0],
        plan: [...copenhagenTrip.days[0].plan].reverse(),
      },
    ],
  };
  const execution = activeState(trip);
  execution.stopExecutions[copenhagenStopIds.marbleChurch] = {
    ...execution.stopExecutions[copenhagenStopIds.marbleChurch],
    status: 'completed',
    completedRecordedAt: startedAt,
    completedOnDayId: trip.days[0].id,
  };
  execution.stopExecutions[copenhagenStopIds.kastellet] = {
    ...execution.stopExecutions[copenhagenStopIds.kastellet],
    status: 'skipped',
  };
  execution.stopExecutions[copenhagenStopIds.reffen] = {
    ...execution.stopExecutions[copenhagenStopIds.reffen],
    scheduledDayId: null,
  };
  const view = deriveRouteMapView(trip, execution);
  assert.deepEqual(
    view.stops.map((stop) => stop.stopId),
    copenhagenTrip.days[0].plan.map((item) => item.stopId),
  );
  assert.deepEqual(
    view.stops.map((stop) => stop.itineraryPosition),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    view.stops.map((stop) => stop.name),
    [
      'Nyhavn',
      'Amalienborg',
      "Marmorkirken / Frederik's Church",
      'Gefion Fountain',
      'Kastellet',
      'Little Mermaid',
      'Refshaleøen / Reffen',
      'Christianshavn',
      'Christiania',
      'Black Diamond',
      'Christiansborg exterior',
      'Christiansborg Tower',
      'Strøget / Old Centre',
      'Round Tower exterior',
      "Rosenborg + King's Garden",
      'Torvehallerne',
    ],
  );
  assert.equal(view.stops[0].status, 'current');
  assert.equal(view.stops[1].status, 'next');
  assert.equal(view.stops[2].status, 'completed');
  assert.equal(
    view.stops.find((stop) => stop.stopId === copenhagenStopIds.kastellet)
      ?.status,
    'skipped',
  );
  assert.equal(
    view.stops.find((stop) => stop.stopId === copenhagenStopIds.reffen)?.status,
    'saved',
  );
  assert.equal(
    view.stops.find((stop) => stop.stopId === copenhagenStopIds.reffen)
      ?.priority,
    'optional',
  );
});

void test('prepared legs are presented schematically without live routing', () => {
  const view = deriveRouteMapView(copenhagenTrip, activeState());
  assert.equal(view.routePresentation, 'schematic-endpoints');
  assert.equal(view.stops.length, 16);
  assert.equal(view.legs.length, 15);
  assert.deepEqual(
    view.legs.map((leg) => leg.mode),
    [
      'walk',
      'walk',
      'walk',
      'walk',
      'walk',
      'ferry',
      'ferry',
      'walk',
      'walk',
      'walk',
      'walk',
      'walk',
      'walk',
      'walk',
      'walk',
    ],
  );
  assert.ok(
    view.legs.every((leg) => leg.representation === 'schematic-endpoints'),
  );
  assert.equal(
    view.legs.some(
      (leg) => leg.legId === 'copenhagen-little-mermaid-christianshavn',
    ),
    false,
  );
});

void test('missing Mapbox token has an explicit deterministic state', () => {
  assert.equal(mapboxTokenState(undefined), 'missing');
  assert.equal(mapboxTokenState('  '), 'missing');
  assert.equal(mapboxTokenState('pk.public'), 'available');
});

void test('Google Maps URL is deterministic and coordinate-based', () => {
  assert.equal(
    buildGoogleMapsNavigationUrl(
      { latitude: 55.6797, longitude: 12.5909 },
      'walking',
    ),
    'https://www.google.com/maps/dir/?api=1&destination=55.6797%2C12.5909&travelmode=walking',
  );
});

void test('ordinary navigation targets Current only and never Next or Airport', () => {
  const prestart = initialState();
  assert.equal(
    currentGoogleMapsNavigationUrl(copenhagenTrip, prestart),
    undefined,
  );
  const execution = activeState();
  const url = currentGoogleMapsNavigationUrl(copenhagenTrip, execution);
  assert.ok(url?.includes('destination=55.6797%2C12.5909'));
  assert.equal(url?.includes('55.6841'), false);
  assert.equal(
    url?.includes(encodeURIComponent(copenhagenAirport.name)),
    false,
  );
});

void test('GPS availability and viewed details cannot affect Current navigation', () => {
  const execution = activeState();
  const deniedLocation: ForegroundLocationState = {
    status: 'denied',
    message: 'denied',
  };
  const viewedFutureStopId = copenhagenStopIds.kastellet;
  assert.equal(deniedLocation.status, 'denied');
  assert.notEqual(viewedFutureStopId, execution.currentStopId);
  assert.ok(
    currentGoogleMapsNavigationUrl(copenhagenTrip, execution)?.includes(
      'destination=55.6797%2C12.5909',
    ),
  );
});

void test('prepared inbound travel modes map only when unambiguous', () => {
  assert.equal(googleMapsTravelMode('walk'), 'walking');
  assert.equal(googleMapsTravelMode('transit'), 'transit');
  assert.equal(googleMapsTravelMode('ferry'), 'transit');
  assert.equal(googleMapsTravelMode('other'), undefined);

  const walkingState: TripExecutionState = {
    ...activeState(),
    currentStopId: copenhagenStopIds.amalienborg,
    currentInboundTravel: {
      fromStopId: copenhagenStopIds.nyhavn,
      toStopId: copenhagenStopIds.amalienborg,
      duration: { status: 'unknown' },
    },
  };
  assert.ok(
    currentGoogleMapsNavigationUrl(copenhagenTrip, walkingState)?.includes(
      'travelmode=walking',
    ),
  );

  const ferryState: TripExecutionState = {
    ...walkingState,
    currentStopId: copenhagenStopIds.reffen,
    currentInboundTravel: {
      fromStopId: copenhagenStopIds.littleMermaid,
      toStopId: copenhagenStopIds.reffen,
      duration: { status: 'unknown' },
    },
  };
  assert.ok(
    currentGoogleMapsNavigationUrl(copenhagenTrip, ferryState)?.includes(
      'travelmode=transit',
    ),
  );

  const ambiguousTrip: Trip = {
    ...copenhagenTrip,
    legs: [
      ...(copenhagenTrip.legs ?? []),
      { ...(copenhagenTrip.legs ?? [])[0], id: 'duplicate-inbound' },
    ],
  };
  assert.equal(
    currentGoogleMapsNavigationUrl(ambiguousTrip, walkingState)?.includes(
      'travelmode=',
    ),
    false,
  );
});

void test('Start & Navigate starts, persists and targets resulting Current', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const result = startDayAndBuildNavigation(
    copenhagenTrip,
    initialState(),
    copenhagenTrip.days[0].id,
    startedAt,
    storage,
  );
  assert.equal(result.status, 'accepted');
  assert.equal(result.result.state.currentStopId, copenhagenStopIds.nyhavn);
  assert.equal(result.result.persistence.status, 'saved');
  assert.ok(values.has(executionStorageKey(copenhagenTrip.id)));
  assert.ok(result.navigationUrl?.includes('destination=55.6797%2C12.5909'));
});

void test('failed Start does not save or produce a navigation target', () => {
  let writes = 0;
  const storage = {
    getItem: () => null,
    setItem: () => {
      writes += 1;
    },
    removeItem: () => undefined,
  };
  const result = startDayAndBuildNavigation(
    copenhagenTrip,
    activeState(),
    copenhagenTrip.days[0].id,
    startedAt,
    storage,
  );
  assert.equal(result.status, 'rejected');
  assert.equal(writes, 0);
  assert.equal('navigationUrl' in result, false);
});

void test('write failure keeps accepted Start state and navigation target', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => undefined,
  };
  const result = startDayAndBuildNavigation(
    copenhagenTrip,
    initialState(),
    copenhagenTrip.days[0].id,
    startedAt,
    storage,
  );
  assert.equal(result.status, 'accepted');
  assert.equal(result.result.persistence.status, 'unavailable');
  assert.equal(result.result.state.currentStopId, copenhagenStopIds.nyhavn);
  assert.ok(result.navigationUrl?.includes('destination=55.6797%2C12.5909'));
});

void test('Start & Navigate follows DayPlanItem.order, not plan array position', () => {
  const trip: Trip = {
    ...copenhagenTrip,
    days: [
      {
        ...copenhagenTrip.days[0],
        plan: [...copenhagenTrip.days[0].plan].reverse(),
      },
    ],
  };
  const result = startDayAndBuildNavigation(
    trip,
    initialState(trip),
    trip.days[0].id,
    startedAt,
    {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  );
  assert.equal(result.status, 'accepted');
  assert.equal(result.result.state.currentStopId, copenhagenStopIds.nyhavn);
  assert.ok(result.navigationUrl?.includes('destination=55.6797%2C12.5909'));
});
