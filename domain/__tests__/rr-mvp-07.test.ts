import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  deriveRouteMapView,
  loadExecutionState,
  saveExecutionState,
  skipCurrentStop,
  startDay,
  startDayAndBuildNavigation,
  type TransitionResult,
  type TripExecutionState,
} from '../index.ts';

const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:30:00.000Z';

function initialState() {
  return createInitialTripExecutionState(copenhagenTrip, initializedAt);
}

function acceptedState(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function activeState() {
  return acceptedState(
    startDay(
      copenhagenTrip,
      initialState(),
      copenhagenTrip.days[0].id,
      startedAt,
    ),
  );
}

void test('real fixture advances through the northern route in authoritative order', () => {
  let state = activeState();
  const expectedCurrents = [
    copenhagenStopIds.nyhavn,
    copenhagenStopIds.amalienborg,
    copenhagenStopIds.marbleChurch,
    copenhagenStopIds.gefionFountain,
    copenhagenStopIds.kastellet,
    copenhagenStopIds.littleMermaid,
    copenhagenStopIds.reffen,
  ];

  for (const expected of expectedCurrents) {
    assert.equal(state.currentStopId, expected);
    if (expected !== copenhagenStopIds.reffen) {
      state = acceptedState(
        completeCurrentStop(copenhagenTrip, state, state.lastUpdatedAt),
      );
    }
  }
});

void test('manual Reffen Skip advances directly to Christianshavn', () => {
  let state = activeState();
  while (state.currentStopId !== copenhagenStopIds.reffen) {
    state = acceptedState(
      completeCurrentStop(copenhagenTrip, state, state.lastUpdatedAt),
    );
  }

  const skipped = skipCurrentStop(copenhagenTrip, state, state.lastUpdatedAt);
  assert.equal(skipped.ok, true);
  assert.equal(
    skipped.state.stopExecutions[copenhagenStopIds.reffen].status,
    'skipped',
  );
  assert.equal(skipped.state.currentStopId, copenhagenStopIds.christianshavn);
});

void test('Start & Navigate persists Nyhavn Current and targets its coordinates', () => {
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
  assert.ok(result.navigationUrl?.includes('destination=55.6797%2C12.5909'));
  const restored = loadExecutionState(copenhagenTrip, storage);
  assert.equal(restored.status, 'restored');
  assert.equal(restored.state.currentStopId, copenhagenStopIds.nyhavn);
});

void test('expanded execution remains serializable and persistable', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const state = activeState();
  assert.equal(
    saveExecutionState(copenhagenTrip, state, state.lastUpdatedAt, storage)
      .status,
    'saved',
  );
  const restored = loadExecutionState(copenhagenTrip, storage);
  assert.equal(restored.status, 'restored');
  assert.deepEqual(restored.state, state);
  assert.equal(Object.keys(restored.state.stopExecutions).length, 16);
});

void test('map view derives 16 StopId markers, Current, Next and optional Reffen', () => {
  const state = activeState();
  const view = deriveRouteMapView(copenhagenTrip, state);

  assert.equal(view.stops.length, 16);
  assert.deepEqual(
    view.stops.map((stop) => stop.stopId),
    copenhagenTrip.days[0].plan.map((item) => item.stopId),
  );
  assert.equal(
    view.stops.find((stop) => stop.status === 'current')?.stopId,
    state.currentStopId,
  );
  assert.equal(
    view.stops.find((stop) => stop.status === 'next')?.stopId,
    copenhagenStopIds.amalienborg,
  );
  assert.deepEqual(
    view.stops
      .filter((stop) => stop.priority === 'optional')
      .map((stop) => stop.stopId),
    [copenhagenStopIds.reffen],
  );
  assert.equal(view.userLocation, undefined);
});

void test('map bounds input spans Torvehallerne, Reffen and the north-south route', () => {
  const userLocation = {
    latitude: 55.68,
    longitude: 12.59,
    accuracy: 5,
    observedAt: startedAt,
  };
  const state = activeState();
  const view = deriveRouteMapView(copenhagenTrip, state, userLocation);
  const latitudes = view.stops.map((stop) => stop.latitude);
  const longitudes = view.stops.map((stop) => stop.longitude);

  assert.equal(Math.min(...longitudes), 12.5694757);
  assert.equal(Math.max(...longitudes), 12.60978);
  assert.equal(Math.min(...latitudes), 55.6723737);
  assert.equal(Math.max(...latitudes), 55.69317);
  assert.deepEqual(view.userLocation, userLocation);
  assert.equal(state.currentStopId, copenhagenStopIds.nyhavn);
  assert.ok(
    view.legs.every((leg) => leg.representation === 'schematic-endpoints'),
  );
});
