import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  currentGoogleMapsNavigationUrl,
  deriveRouteMapView,
  saveCurrentForLater,
  skipCurrentStop,
  startDay,
  type TransitionResult,
  type Trip,
  type TripExecutionState,
} from '../index.ts';
import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';

const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:30:00.000Z';

function acceptedState(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function twoStopTrip(waypointCount: 0 | 1 | 2 | 3 = 1): {
  trip: Trip;
  firstId: ReturnType<typeof createStopId>;
  secondId: ReturnType<typeof createStopId>;
} {
  const firstId = createStopId('first');
  const secondId = createStopId('second');
  const waypoints = [
    { latitude: 30, longitude: 40 },
    { latitude: 50, longitude: 60 },
    { latitude: 70, longitude: 80 },
  ].slice(0, waypointCount);
  return {
    firstId,
    secondId,
    trip: {
      id: 'planned-path-test',
      title: 'Planned path test',
      timeZone: 'UTC',
      startDate: '2026-09-08',
      endDate: '2026-09-08',
      stops: [
        {
          id: firstId,
          name: 'First',
          latitude: 10,
          longitude: 20,
          priority: 'normal',
          canSkip: true,
          plannedVisitMinutes: 10,
        },
        {
          id: secondId,
          name: 'Second',
          latitude: 90,
          longitude: 100,
          priority: 'normal',
          canSkip: true,
          plannedVisitMinutes: 10,
        },
      ],
      days: [
        {
          id: 'day',
          date: '2026-09-08',
          plan: [
            { stopId: firstId, order: 10 },
            { stopId: secondId, order: 20 },
          ],
        },
      ],
      legs: [
        {
          id: 'first-second',
          fromStopId: firstId,
          toStopId: secondId,
          mode: 'walk',
          navigationWaypoints: waypoints,
        },
      ],
    },
  };
}

function firstCurrentState(trip: Trip): TripExecutionState {
  return acceptedState(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      trip.days[0].id,
      startedAt,
    ),
  );
}

function advance(
  trip: Trip,
  transition: typeof completeCurrentStop,
): TripExecutionState {
  return acceptedState(
    transition(trip, firstCurrentState(trip), '2026-09-08T09:00:00.000Z'),
  );
}

void test('completed source produces one to three ordered Via points without mutation or Stop conversion', () => {
  for (const waypointCount of [1, 2, 3] as const) {
    const { trip } = twoStopTrip(waypointCount);
    const state = advance(trip, completeCurrentStop);
    const tripBefore = structuredClone(trip);
    const stateBefore = structuredClone(state);
    const view = deriveRouteMapView(trip, state);

    assert.deepEqual(
      view.navigationViaPoints,
      [
        { longitude: 40, latitude: 30 },
        { longitude: 60, latitude: 50 },
        { longitude: 80, latitude: 70 },
      ].slice(0, waypointCount),
    );
    assert.equal(view.stops.length, 2);
    assert.deepEqual(
      view.stops.map((stop) => stop.itineraryPosition),
      [1, 2],
    );
    assert.deepEqual(trip, tripBefore);
    assert.deepEqual(state, stateBefore);
  }
});

for (const [name, transition] of [
  ['Skip', skipCurrentStop],
  ['Save for later', saveCurrentForLater],
] as const) {
  void test(`${name} suppresses Via points`, () => {
    const { trip } = twoStopTrip();
    const state = advance(trip, transition);
    assert.deepEqual(deriveRouteMapView(trip, state).navigationViaPoints, []);
  });
}

void test('null and missing source provenance suppress Via points', () => {
  const { trip, firstId } = twoStopTrip();
  const completed = advance(trip, completeCurrentStop);
  const nullSource: TripExecutionState = {
    ...completed,
    currentInboundTravel: {
      ...completed.currentInboundTravel!,
      fromStopId: null,
    },
  };
  assert.deepEqual(
    deriveRouteMapView(trip, nullSource).navigationViaPoints,
    [],
  );

  const missingSource: TripExecutionState = {
    ...completed,
    stopExecutions: { ...completed.stopExecutions },
  };
  delete missingSource.stopExecutions[firstId];
  assert.deepEqual(
    deriveRouteMapView(trip, missingSource).navigationViaPoints,
    [],
  );
});

void test('mismatched source identity suppresses Via points', () => {
  const { trip, firstId, secondId } = twoStopTrip();
  const completed = advance(trip, completeCurrentStop);
  const mismatched: TripExecutionState = {
    ...completed,
    stopExecutions: {
      ...completed.stopExecutions,
      [firstId]: {
        ...completed.stopExecutions[firstId],
        stopId: secondId,
      },
    },
  };
  assert.deepEqual(
    deriveRouteMapView(trip, mismatched).navigationViaPoints,
    [],
  );
});

void test('ambiguous and unrelated inbound Legs suppress Via points', () => {
  const { trip, firstId, secondId } = twoStopTrip();
  const completed = advance(trip, completeCurrentStop);
  const ambiguousTrip: Trip = {
    ...trip,
    legs: [...trip.legs!, { ...trip.legs![0], id: 'duplicate' }],
  };
  assert.deepEqual(
    deriveRouteMapView(ambiguousTrip, completed).navigationViaPoints,
    [],
  );

  const unrelated: TripExecutionState = {
    ...completed,
    currentInboundTravel: {
      fromStopId: firstId,
      toStopId: firstId,
      duration: { status: 'unknown' },
    },
  };
  assert.deepEqual(deriveRouteMapView(trip, unrelated).navigationViaPoints, []);
  assert.equal(completed.currentStopId, secondId);
});

void test('first stop and no-waypoint inbound Leg produce no Via points', () => {
  const withWaypoint = twoStopTrip();
  assert.deepEqual(
    deriveRouteMapView(withWaypoint.trip, firstCurrentState(withWaypoint.trip))
      .navigationViaPoints,
    [],
  );

  const withoutWaypoint = twoStopTrip(0);
  assert.deepEqual(
    deriveRouteMapView(
      withoutWaypoint.trip,
      advance(withoutWaypoint.trip, completeCurrentStop),
    ).navigationViaPoints,
    [],
  );
});

void test('waypoints on an unsupported travel mode are not presentation-safe', () => {
  const { trip } = twoStopTrip();
  trip.legs![0].mode = 'transit';
  assert.deepEqual(
    deriveRouteMapView(trip, advance(trip, completeCurrentStop))
      .navigationViaPoints,
    [],
  );
});

void test('Copenhagen Done exposes one Via point, then removes it after Gefion', () => {
  let state = firstCurrentState(copenhagenTrip);
  for (let completed = 0; completed < 3; completed += 1) {
    state = acceptedState(
      completeCurrentStop(copenhagenTrip, state, state.lastUpdatedAt),
    );
  }
  assert.equal(state.currentStopId, copenhagenStopIds.gefionFountain);

  const view = deriveRouteMapView(copenhagenTrip, state);
  assert.deepEqual(view.navigationViaPoints, [
    { longitude: 12.5964, latitude: 55.6846 },
  ]);
  assert.equal(view.stops.length, 16);
  assert.deepEqual(
    view.stops.map((stop) => stop.itineraryPosition),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );

  const navigationUrl = currentGoogleMapsNavigationUrl(copenhagenTrip, state)!;
  assert.equal(
    new URL(navigationUrl).searchParams.get('waypoints'),
    '55.6846,12.5964',
  );

  state = acceptedState(
    completeCurrentStop(copenhagenTrip, state, state.lastUpdatedAt),
  );
  assert.equal(state.currentStopId, copenhagenStopIds.kastellet);
  assert.deepEqual(
    deriveRouteMapView(copenhagenTrip, state).navigationViaPoints,
    [],
  );
});
