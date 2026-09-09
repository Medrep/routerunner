import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGoogleMapsNavigationUrl,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  currentGoogleMapsNavigationUrl,
  deriveRouteMapView,
  startDay,
  startDayAndBuildNavigation,
  validateTrip,
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

function activeCopenhagenState(): TripExecutionState {
  return acceptedState(
    startDay(
      copenhagenTrip,
      createInitialTripExecutionState(copenhagenTrip, initializedAt),
      copenhagenTrip.days[0].id,
      startedAt,
    ),
  );
}

function waypointValidationTrip(): Trip {
  const firstId = createStopId('first');
  const secondId = createStopId('second');
  return {
    id: 'waypoint-validation',
    title: 'Waypoint validation',
    timeZone: 'Europe/Copenhagen',
    startDate: '2026-09-08',
    endDate: '2026-09-08',
    stops: [firstId, secondId].map((id) => ({
      id,
      name: id,
      latitude: 55,
      longitude: 12,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 10,
    })),
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
      },
    ],
  };
}

void test('no navigation waypoints preserves the direct Google Maps URL', () => {
  assert.equal(
    buildGoogleMapsNavigationUrl(
      { latitude: 55.6797, longitude: 12.5909 },
      'walking',
    ),
    'https://www.google.com/maps/dir/?api=1&destination=55.6797%2C12.5909&travelmode=walking',
  );
});

void test('one navigation waypoint is encoded without adding an origin', () => {
  const url = buildGoogleMapsNavigationUrl(
    { latitude: 55.6890868, longitude: 12.597464 },
    'walking',
    [{ latitude: 55.6846, longitude: 12.5964 }],
  );
  assert.equal(new URL(url).searchParams.get('origin'), null);
  assert.equal(new URL(url).searchParams.get('waypoints'), '55.6846,12.5964');
});

void test('multiple navigation waypoints preserve exact input order', () => {
  const waypoints = [
    { latitude: 1, longitude: 2 },
    { latitude: 3, longitude: 4 },
    { latitude: 5, longitude: 6 },
  ] as const;
  const url = buildGoogleMapsNavigationUrl(
    { latitude: 7, longitude: 8 },
    'walking',
    waypoints,
  );
  assert.equal(new URL(url).searchParams.get('waypoints'), '1,2|3,4|5,6');
  assert.deepEqual(waypoints, [
    { latitude: 1, longitude: 2 },
    { latitude: 3, longitude: 4 },
    { latitude: 5, longitude: 6 },
  ]);
  assert.match(url, /waypoints=1%2C2%7C3%2C4%7C5%2C6/);
});

void test('validation accepts three ordered navigation waypoints', () => {
  const trip = waypointValidationTrip();
  trip.legs![0].navigationWaypoints = [
    { latitude: -90, longitude: -180 },
    { latitude: 0, longitude: 0 },
    { latitude: 90, longitude: 180 },
  ];
  const before = structuredClone(trip);
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
  assert.deepEqual(trip, before);
});

void test('validation rejects more than three navigation waypoints', () => {
  const trip = waypointValidationTrip();
  trip.legs![0].navigationWaypoints = Array.from({ length: 4 }, (_, index) => ({
    latitude: index,
    longitude: index,
  }));
  assert.ok(
    validateTrip(trip).errors.some(
      ({ code, path }) =>
        code === 'TOO_MANY_NAVIGATION_WAYPOINTS' &&
        path === 'legs[0].navigationWaypoints',
    ),
  );
});

for (const invalid of [
  { field: 'latitude', value: -91 },
  { field: 'latitude', value: 91 },
  { field: 'longitude', value: -181 },
  { field: 'longitude', value: 181 },
] as const) {
  void test(`validation rejects waypoint ${invalid.field} ${invalid.value}`, () => {
    const trip = waypointValidationTrip();
    trip.legs![0].navigationWaypoints = [
      {
        latitude: invalid.field === 'latitude' ? invalid.value : 55,
        longitude: invalid.field === 'longitude' ? invalid.value : 12,
      },
    ];
    assert.ok(
      validateTrip(trip).errors.some(
        ({ code, path }) =>
          code === 'INVALID_NUMBER' &&
          path === `legs[0].navigationWaypoints[0].${invalid.field}`,
      ),
    );
  });
}

void test('validation rejects waypoints for modes Google Maps cannot route safely', () => {
  for (const mode of ['transit', 'ferry', 'other'] as const) {
    const trip = waypointValidationTrip();
    trip.legs![0].mode = mode;
    trip.legs![0].navigationWaypoints = [{ latitude: 55, longitude: 12 }];
    assert.ok(
      validateTrip(trip).errors.some(
        ({ code, path }) =>
          code === 'UNSUPPORTED_NAVIGATION_WAYPOINT_MODE' &&
          path === 'legs[0].navigationWaypoints',
      ),
      mode,
    );
  }
});

void test('navigation waypoints remain Leg data and never become execution or map Stops', () => {
  const leg = copenhagenTrip.legs!.find(
    (candidate) =>
      candidate.fromStopId === copenhagenStopIds.marbleChurch &&
      candidate.toStopId === copenhagenStopIds.gefionFountain,
  )!;
  assert.deepEqual(leg.navigationWaypoints, [
    { latitude: 55.6846, longitude: 12.5964 },
  ]);
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.equal(copenhagenTrip.days[0].plan.length, 16);

  const state = activeCopenhagenState();
  assert.equal(Object.keys(state.stopExecutions).length, 16);
  assert.equal(deriveRouteMapView(copenhagenTrip, state).stops.length, 16);
});

void test('actual Current inbound Leg supplies its waypoints and walking mode', () => {
  let state = activeCopenhagenState();
  for (let completed = 0; completed < 3; completed += 1) {
    state = acceptedState(
      completeCurrentStop(copenhagenTrip, state, state.lastUpdatedAt),
    );
  }
  assert.equal(state.currentStopId, copenhagenStopIds.gefionFountain);
  assert.deepEqual(state.currentInboundTravel, {
    fromStopId: copenhagenStopIds.marbleChurch,
    toStopId: copenhagenStopIds.gefionFountain,
    duration: { status: 'unknown', reason: 'unresolved' },
  });

  const url = new URL(currentGoogleMapsNavigationUrl(copenhagenTrip, state)!);
  assert.equal(url.searchParams.get('destination'), '55.6890868,12.597464');
  assert.equal(url.searchParams.get('travelmode'), 'walking');
  assert.equal(url.searchParams.get('waypoints'), '55.6846,12.5964');
  assert.equal(url.searchParams.get('origin'), null);
});

void test('unrelated and ambiguous Leg waypoints cannot leak into Current navigation', () => {
  const state: TripExecutionState = {
    ...activeCopenhagenState(),
    currentStopId: copenhagenStopIds.gefionFountain,
    currentInboundTravel: {
      fromStopId: copenhagenStopIds.amalienborg,
      toStopId: copenhagenStopIds.gefionFountain,
      duration: { status: 'unknown' },
    },
  };
  assert.equal(
    new URL(
      currentGoogleMapsNavigationUrl(copenhagenTrip, state)!,
    ).searchParams.get('waypoints'),
    null,
  );

  const ambiguousTrip: Trip = {
    ...copenhagenTrip,
    legs: [
      ...(copenhagenTrip.legs ?? []),
      {
        ...copenhagenTrip.legs!.find(
          (leg) => leg.id === 'copenhagen-marble-church-gefion-fountain',
        )!,
        id: 'ambiguous-marble-church-gefion-fountain',
      },
    ],
  };
  const actualInboundState: TripExecutionState = {
    ...state,
    currentInboundTravel: {
      fromStopId: copenhagenStopIds.marbleChurch,
      toStopId: copenhagenStopIds.gefionFountain,
      duration: { status: 'unknown' },
    },
  };
  assert.equal(
    new URL(
      currentGoogleMapsNavigationUrl(ambiguousTrip, actualInboundState)!,
    ).searchParams.get('waypoints'),
    null,
  );
});

void test('Start & Navigate to the first stop does not use unrelated waypoints', () => {
  const result = startDayAndBuildNavigation(
    copenhagenTrip,
    createInitialTripExecutionState(copenhagenTrip, initializedAt),
    copenhagenTrip.days[0].id,
    startedAt,
    {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  );
  assert.equal(result.status, 'accepted');
  const url = new URL(result.navigationUrl!);
  assert.equal(url.searchParams.get('destination'), '55.6797,12.5909');
  assert.equal(url.searchParams.get('waypoints'), null);
  assert.equal(url.searchParams.get('origin'), null);
});
