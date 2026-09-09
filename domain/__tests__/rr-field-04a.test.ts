import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
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

void test('completed source produces ordered source-waypoints-destination geometry without mutation', () => {
  for (const waypointCount of [1, 2, 3] as const) {
    const { trip, firstId, secondId } = twoStopTrip(waypointCount);
    const state = advance(trip, completeCurrentStop);
    const tripBefore = structuredClone(trip);
    const stateBefore = structuredClone(state);

    assert.deepEqual(deriveRouteMapView(trip, state).plannedPath, {
      fromStopId: firstId,
      toStopId: secondId,
      coordinates: [
        [20, 10],
        ...[
          [40, 30],
          [60, 50],
          [80, 70],
        ].slice(0, waypointCount),
        [100, 90],
      ],
    });
    assert.deepEqual(trip, tripBefore);
    assert.deepEqual(state, stateBefore);
  }
});

for (const [name, transition] of [
  ['Skip', skipCurrentStop],
  ['Save for later', saveCurrentForLater],
] as const) {
  void test(`${name} suppresses the planned path`, () => {
    const { trip } = twoStopTrip();
    const state = advance(trip, transition);
    assert.equal(deriveRouteMapView(trip, state).plannedPath, undefined);
  });
}

void test('null and missing source provenance suppress the planned path', () => {
  const { trip, firstId } = twoStopTrip();
  const completed = advance(trip, completeCurrentStop);
  const nullSource: TripExecutionState = {
    ...completed,
    currentInboundTravel: {
      ...completed.currentInboundTravel!,
      fromStopId: null,
    },
  };
  assert.equal(deriveRouteMapView(trip, nullSource).plannedPath, undefined);

  const missingSource: TripExecutionState = {
    ...completed,
    stopExecutions: { ...completed.stopExecutions },
  };
  delete missingSource.stopExecutions[firstId];
  assert.equal(deriveRouteMapView(trip, missingSource).plannedPath, undefined);
});

void test('mismatched source identity suppresses the planned path', () => {
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
  assert.equal(deriveRouteMapView(trip, mismatched).plannedPath, undefined);
});

void test('ambiguous and unrelated inbound Legs suppress the planned path', () => {
  const { trip, firstId, secondId } = twoStopTrip();
  const completed = advance(trip, completeCurrentStop);
  const ambiguousTrip: Trip = {
    ...trip,
    legs: [...trip.legs!, { ...trip.legs![0], id: 'duplicate' }],
  };
  assert.equal(
    deriveRouteMapView(ambiguousTrip, completed).plannedPath,
    undefined,
  );

  const unrelated: TripExecutionState = {
    ...completed,
    currentInboundTravel: {
      fromStopId: firstId,
      toStopId: firstId,
      duration: { status: 'unknown' },
    },
  };
  assert.equal(deriveRouteMapView(trip, unrelated).plannedPath, undefined);
  assert.equal(completed.currentStopId, secondId);
});

void test('first stop and no-waypoint inbound Leg never create a synthetic path', () => {
  const withWaypoint = twoStopTrip();
  assert.equal(
    deriveRouteMapView(withWaypoint.trip, firstCurrentState(withWaypoint.trip))
      .plannedPath,
    undefined,
  );

  const withoutWaypoint = twoStopTrip(0);
  assert.equal(
    deriveRouteMapView(
      withoutWaypoint.trip,
      advance(withoutWaypoint.trip, completeCurrentStop),
    ).plannedPath,
    undefined,
  );
});

void test('waypoints on an unsupported travel mode are not presentation-safe', () => {
  const { trip } = twoStopTrip();
  trip.legs![0].mode = 'transit';
  assert.equal(
    deriveRouteMapView(trip, advance(trip, completeCurrentStop)).plannedPath,
    undefined,
  );
});

void test('Copenhagen Done renders Marmorkirken via Larsens Plads to Gefion without adding a marker', () => {
  let state = firstCurrentState(copenhagenTrip);
  for (let completed = 0; completed < 3; completed += 1) {
    state = acceptedState(
      completeCurrentStop(copenhagenTrip, state, state.lastUpdatedAt),
    );
  }
  assert.equal(state.currentStopId, copenhagenStopIds.gefionFountain);

  const view = deriveRouteMapView(copenhagenTrip, state);
  const marmorkirken = copenhagenTrip.stops.find(
    (stop) => stop.id === copenhagenStopIds.marbleChurch,
  )!;
  const gefion = copenhagenTrip.stops.find(
    (stop) => stop.id === copenhagenStopIds.gefionFountain,
  )!;
  assert.deepEqual(view.plannedPath, {
    fromStopId: copenhagenStopIds.marbleChurch,
    toStopId: copenhagenStopIds.gefionFountain,
    coordinates: [
      [marmorkirken.longitude, marmorkirken.latitude],
      [12.5964, 55.6846],
      [gefion.longitude, gefion.latitude],
    ],
  });
  assert.equal(view.stops.length, 16);
  assert.deepEqual(
    view.stops.map((stop) => stop.itineraryPosition),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
});
