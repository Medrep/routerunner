import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveTripOverviewPresentation } from '../../components/routerunner/trip-overview-presentation.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  selectableTrips,
  selectTrip,
  selectTripFromSearch,
  tripSelectionHref,
} from '../../data/trips/index.ts';
import { krakowField06Trip } from '../../data/trips/krakow.ts';
import {
  romeDayIds,
  romeFiumicinoAirport,
  romeStopIds,
  romeTrip,
} from '../../data/trips/rome.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  deriveDayPreviewRouteMapView,
  deriveRouteMapView,
  doNowStop,
  endDay,
  EXECUTION_STATE_SCHEMA_VERSION,
  loadExecutionState,
  markAlreadyVisited,
  orderedDayPlan,
  orderedStopVisitPlanItems,
  originalPlannedDayId,
  pendingForLaterActionModels,
  postDayGoogleMapsNavigationUrl,
  projectSchedule,
  projectedExecutionStopIds,
  saveCurrentForLater,
  saveExecutionState,
  startDay,
  switchExecutionDay,
  tripExecutionLifecycle,
  validateTrip,
} from '../index.ts';
import type {
  ExecutionStorage,
  StopId,
  TransitionResult,
  TripExecutionState,
} from '../index.ts';

const initializedAt = '2026-09-16T07:00:00.000Z';

class FakeStorage implements ExecutionStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function at(minute: number): string {
  return new Date(Date.parse(initializedAt) + minute * 60_000).toISOString();
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function startedDay1(): TripExecutionState {
  return accepted(
    startDay(
      romeTrip,
      createInitialTripExecutionState(romeTrip, initializedAt),
      romeDayIds.day1,
      at(1),
    ),
  );
}

function completeActiveDay(
  initial: TripExecutionState,
  firstMinute: number,
): TripExecutionState {
  let state = initial;
  let minute = firstMinute;
  let transitions = 0;
  while (state.currentStopId) {
    state = accepted(completeCurrentStop(romeTrip, state, at(minute)));
    minute += 1;
    transitions += 1;
    assert.ok(transitions <= romeTrip.stops.length);
  }
  return state;
}

function roundTrip(state: TripExecutionState): TripExecutionState {
  const storage = new FakeStorage();
  assert.deepEqual(
    saveExecutionState(romeTrip, state, state.lastUpdatedAt, storage),
    { status: 'saved', savedAt: state.lastUpdatedAt },
  );
  const loaded = loadExecutionState(romeTrip, storage);
  assert.equal(loaded.status, 'restored');
  return loaded.state;
}

function stop(stopId: StopId) {
  const value = romeTrip.stops.find((candidate) => candidate.id === stopId);
  assert.ok(value);
  return value;
}

void test('production repository exposes the owner-approved Rome trip through existing selectors', () => {
  assert.equal(selectableTrips.length, 3);
  assert.deepEqual(
    selectableTrips.map(({ label, trip }) => [label, trip.id]),
    [
      ['Copenhagen', copenhagenTrip.id],
      ['Kraków field test', krakowField06Trip.id],
      ['Rome field test', romeTrip.id],
    ],
  );
  assert.equal(selectTrip(romeTrip.id), romeTrip);
  assert.equal(
    selectTripFromSearch(`?trip=${encodeURIComponent(romeTrip.id)}`),
    romeTrip,
  );
  assert.equal(tripSelectionHref(romeTrip.id), `?trip=${romeTrip.id}`);
});

void test('Rome fixture has exact identity, dates, two days, and canonical owner plan', () => {
  assert.equal(romeTrip.id, 'rome-field-test-2026');
  assert.equal(
    romeTrip.title,
    'Rome — Vatican, Historic Centre & Ancient Rome',
  );
  assert.equal(romeTrip.city, 'Rome');
  assert.equal(romeTrip.timeZone, 'Europe/Rome');
  assert.equal(romeTrip.startDate, '2026-09-16');
  assert.equal(romeTrip.endDate, '2026-09-17');
  assert.equal(romeTrip.days.length, 2);
  assert.deepEqual(
    romeTrip.days.map(({ id, date, title }) => ({ id, date, title })),
    [
      {
        id: romeDayIds.day1,
        date: '2026-09-16',
        title: 'Historic Centre + Vatican + Rome After Dark',
      },
      {
        id: romeDayIds.day2,
        date: '2026-09-17',
        title: 'St Peter’s + Ancient Rome + Aventine + Trastevere',
      },
    ],
  );
  assert.deepEqual(
    orderedDayPlan(romeTrip.days[0]).map(({ stopId, order }) => ({
      stopId,
      order,
    })),
    [
      romeStopIds.ciampinoAirport,
      romeStopIds.spanishSteps,
      romeStopIds.treviFountain,
      romeStopIds.pantheon,
      romeStopIds.piazzaNavona,
      romeStopIds.vaticanMuseums,
      romeStopIds.stPetersSquare,
      romeStopIds.castelSantAngelo,
      romeStopIds.piazzaVenezia,
      romeStopIds.laCasaDiElena,
    ].map((stopId, index) => ({ stopId, order: (index + 1) * 10 })),
  );
  assert.deepEqual(
    orderedDayPlan(romeTrip.days[1]).map(({ stopId, order }) => ({
      stopId,
      order,
    })),
    [
      romeStopIds.stPetersBasilica,
      romeStopIds.colosseum,
      romeStopIds.forumPalatine,
      romeStopIds.circusMaximus,
      romeStopIds.orangeGarden,
      romeStopIds.aventineKeyhole,
      romeStopIds.teatroGhetto,
      romeStopIds.tiberIsland,
      romeStopIds.trastevere,
    ].map((stopId, index) => ({ stopId, order: (index + 1) * 10 })),
  );
});

void test('Rome Stops preserve approved coordinates, priorities, durations, and planned starts', () => {
  const expected = [
    [romeStopIds.ciampinoAirport, 41.7999, 12.5949, 'must', false, 30, '09:40'],
    [romeStopIds.spanishSteps, 41.906, 12.4828, 'normal', true, 20, '11:30'],
    [romeStopIds.treviFountain, 41.9009, 12.4833, 'normal', true, 20, '12:00'],
    [romeStopIds.pantheon, 41.8986, 12.4769, 'must', true, 30, '12:35'],
    [romeStopIds.piazzaNavona, 41.8992, 12.4731, 'normal', true, 15, '13:15'],
    [romeStopIds.vaticanMuseums, 41.907, 12.4535, 'must', true, 270, '15:00'],
    [romeStopIds.stPetersSquare, 41.9022, 12.4573, 'normal', true, 20, '19:50'],
    [
      romeStopIds.castelSantAngelo,
      41.9031,
      12.4663,
      'normal',
      true,
      20,
      '20:25',
    ],
    [romeStopIds.piazzaVenezia, 41.8958, 12.4823, 'normal', true, 10, '21:15'],
    [romeStopIds.laCasaDiElena, 41.8906, 12.5103, 'must', false, 10, '22:50'],
    [romeStopIds.stPetersBasilica, 41.9022, 12.4539, 'must', true, 60, '07:00'],
    [romeStopIds.colosseum, 41.8902, 12.4922, 'must', true, 90, '09:00'],
    [romeStopIds.forumPalatine, 41.8924, 12.4863, 'must', true, 155, '10:40'],
    [romeStopIds.circusMaximus, 41.8859, 12.4859, 'normal', true, 20, '14:25'],
    [romeStopIds.orangeGarden, 41.8851, 12.4806, 'normal', true, 20, '15:00'],
    [
      romeStopIds.aventineKeyhole,
      41.8829,
      12.478,
      'optional',
      true,
      10,
      '15:25',
    ],
    [romeStopIds.teatroGhetto, 41.8922, 12.4799, 'normal', true, 30, '15:55'],
    [romeStopIds.tiberIsland, 41.8903, 12.4772, 'normal', true, 15, '16:32'],
    [romeStopIds.trastevere, 41.8894, 12.4709, 'normal', true, 48, '16:57'],
  ] as const;
  const plannedStartByStopId = new Map(
    romeTrip.days.flatMap((day) =>
      day.plan.map((item) => [item.stopId, item.plannedStartTime] as const),
    ),
  );
  assert.equal(romeTrip.stops.length, 19);
  assert.deepEqual(
    romeTrip.stops.map((value) => [
      value.id,
      value.latitude,
      value.longitude,
      value.priority,
      value.canSkip,
      value.plannedVisitMinutes,
      plannedStartByStopId.get(value.id),
    ]),
    expected,
  );
  assert.deepEqual(
    romeTrip.stops.filter(({ canSkip }) => !canSkip).map(({ id }) => id),
    [romeStopIds.ciampinoAirport, romeStopIds.laCasaDiElena],
  );
  assert.equal(
    romeTrip.stops
      .filter(
        ({ id }) =>
          id !== romeStopIds.ciampinoAirport &&
          id !== romeStopIds.laCasaDiElena,
      )
      .every(({ canSkip }) => canSkip),
    true,
  );
});

void test('FCO is only the Day-2 post-day destination and has no execution identity', () => {
  assert.deepEqual(romeFiumicinoAirport, {
    id: 'rome-fiumicino-airport',
    name: 'Rome Fiumicino Airport',
    navigationTarget: { latitude: 41.8003, longitude: 12.2389 },
    targetArrivalTime: '18:45',
    plannedTravelMinutes: 60,
    mode: 'transit',
  });
  assert.equal(romeTrip.days[0].postDayDestination, undefined);
  assert.equal(romeTrip.days[1].postDayDestination, romeFiumicinoAirport);
  assert.equal(
    romeTrip.stops.some(({ id }) => id === (romeFiumicinoAirport.id as string)),
    false,
  );
  assert.equal(
    romeTrip.days.some((day) =>
      day.plan.some(
        ({ stopId }) => stopId === (romeFiumicinoAirport.id as string),
      ),
    ),
    false,
  );
  assert.equal(
    romeTrip.legs?.some(
      ({ fromStopId, toStopId }) =>
        fromStopId === (romeFiumicinoAirport.id as string) ||
        toStopId === (romeFiumicinoAirport.id as string),
    ),
    false,
  );
  const initial = createInitialTripExecutionState(romeTrip, initializedAt);
  assert.equal(Object.keys(initial.stopExecutions).length, 19);
  assert.deepEqual(
    Object.keys(initial.stopExecutions),
    romeTrip.stops.map(({ id }) => id),
  );
  assert.equal(
    Object.hasOwn(initial.stopExecutions, romeFiumicinoAirport.id),
    false,
  );
  assert.equal(
    romeTrip.stops.filter(({ id }) => id === romeStopIds.colosseum).length,
    1,
  );
});

void test('Vatican is the only hard Stop constraint and Colosseum remains an unresolved planned target', () => {
  assert.deepEqual(stop(romeStopIds.vaticanMuseums).timeConstraint, {
    type: 'fixed_time',
    start: '15:00',
  });
  assert.deepEqual(
    romeTrip.stops
      .filter(({ timeConstraint }) => timeConstraint !== undefined)
      .map(({ id }) => id),
    [romeStopIds.vaticanMuseums],
  );
  assert.equal(stop(romeStopIds.colosseum).timeConstraint, undefined);
  assert.match(stop(romeStopIds.colosseum).note ?? '', /unresolved/);
  assert.equal(
    romeTrip.days.every(({ hardEndTime }) => hardEndTime === undefined),
    true,
  );
  assert.equal(romeTrip.rules, undefined);
});

void test('prepared Legs and approved walking navigation waypoints are exact and valid', () => {
  assert.equal(romeTrip.legs?.length, 17);
  assert.deepEqual(
    romeTrip.legs?.map(
      ({ id, fromStopId, toStopId, mode, plannedDurationMinutes }) => [
        id,
        fromStopId,
        toStopId,
        mode,
        plannedDurationMinutes,
      ],
    ),
    [
      [
        'rome-leg-d1-01',
        romeStopIds.ciampinoAirport,
        romeStopIds.spanishSteps,
        'transit',
        75,
      ],
      [
        'rome-leg-d1-02',
        romeStopIds.spanishSteps,
        romeStopIds.treviFountain,
        'walk',
        10,
      ],
      [
        'rome-leg-d1-03',
        romeStopIds.treviFountain,
        romeStopIds.pantheon,
        'walk',
        12,
      ],
      [
        'rome-leg-d1-04',
        romeStopIds.pantheon,
        romeStopIds.piazzaNavona,
        'walk',
        7,
      ],
      [
        'rome-leg-d1-05',
        romeStopIds.piazzaNavona,
        romeStopIds.vaticanMuseums,
        'transit',
        25,
      ],
      [
        'rome-leg-d1-06',
        romeStopIds.vaticanMuseums,
        romeStopIds.stPetersSquare,
        'walk',
        20,
      ],
      [
        'rome-leg-d1-07',
        romeStopIds.stPetersSquare,
        romeStopIds.castelSantAngelo,
        'walk',
        15,
      ],
      [
        'rome-leg-d1-08',
        romeStopIds.castelSantAngelo,
        romeStopIds.piazzaVenezia,
        'walk',
        30,
      ],
      [
        'rome-leg-d1-09',
        romeStopIds.piazzaVenezia,
        romeStopIds.laCasaDiElena,
        'walk',
        35,
      ],
      [
        'rome-leg-d2-02',
        romeStopIds.stPetersBasilica,
        romeStopIds.colosseum,
        'transit',
        45,
      ],
      [
        'rome-leg-d2-03',
        romeStopIds.colosseum,
        romeStopIds.forumPalatine,
        'walk',
        10,
      ],
      [
        'rome-leg-d2-04',
        romeStopIds.forumPalatine,
        romeStopIds.circusMaximus,
        'walk',
        35,
      ],
      [
        'rome-leg-d2-05',
        romeStopIds.circusMaximus,
        romeStopIds.orangeGarden,
        'walk',
        15,
      ],
      [
        'rome-leg-d2-06',
        romeStopIds.orangeGarden,
        romeStopIds.aventineKeyhole,
        'walk',
        5,
      ],
      [
        'rome-leg-d2-07',
        romeStopIds.aventineKeyhole,
        romeStopIds.teatroGhetto,
        'walk',
        20,
      ],
      [
        'rome-leg-d2-08',
        romeStopIds.teatroGhetto,
        romeStopIds.tiberIsland,
        'walk',
        7,
      ],
      [
        'rome-leg-d2-09',
        romeStopIds.tiberIsland,
        romeStopIds.trastevere,
        'walk',
        10,
      ],
    ],
  );
  const stopIds = new Set(romeTrip.stops.map(({ id }) => id));
  assert.equal(
    romeTrip.legs?.every(
      ({ fromStopId, toStopId }) =>
        stopIds.has(fromStopId) && stopIds.has(toStopId),
    ),
    true,
  );
  const waypoints = new Map(
    romeTrip.legs?.map(({ id, navigationWaypoints }) => [
      id,
      navigationWaypoints,
    ]),
  );
  assert.deepEqual(waypoints.get('rome-leg-d1-06'), [
    { latitude: 41.906457, longitude: 12.457801 },
    { latitude: 41.90455, longitude: 12.457737 },
  ]);
  assert.deepEqual(waypoints.get('rome-leg-d1-07'), [
    { latitude: 41.9023, longitude: 12.462 },
  ]);
  assert.deepEqual(waypoints.get('rome-leg-d1-08'), [
    { latitude: 41.901193, longitude: 12.466507 },
  ]);
  assert.deepEqual(waypoints.get('rome-leg-d1-09'), [
    { latitude: 41.893327, longitude: 12.487 },
    { latitude: 41.8902, longitude: 12.4922 },
    { latitude: 41.894825, longitude: 12.491 },
  ]);
  assert.deepEqual(waypoints.get('rome-leg-d2-05'), [
    { latitude: 41.884722, longitude: 12.480278 },
  ]);
  assert.deepEqual(waypoints.get('rome-leg-d2-08'), [
    { latitude: 41.890342, longitude: 12.479663 },
  ]);
  assert.deepEqual(waypoints.get('rome-leg-d2-09'), [
    { latitude: 41.890237, longitude: 12.477303 },
  ]);
  assert.equal(
    romeTrip.legs
      ?.filter(({ mode }) => mode === 'transit')
      .every(({ navigationWaypoints }) => navigationWaypoints === undefined),
    true,
  );
  assert.match(
    romeTrip.legs?.find(({ id }) => id === 'rome-leg-d1-01')?.instruction ?? '',
    /Cinecittà/,
  );
  assert.match(
    romeTrip.legs?.find(({ id }) => id === 'rome-leg-d2-02')?.instruction ?? '',
    /Ottaviano.*Termini/,
  );
});

void test('structured visit plans remain ordered internal content for seven parent Stops', () => {
  const planned = new Map<StopId, number>([
    [romeStopIds.pantheon, 3],
    [romeStopIds.vaticanMuseums, 9],
    [romeStopIds.stPetersBasilica, 5],
    [romeStopIds.colosseum, 4],
    [romeStopIds.forumPalatine, 6],
    [romeStopIds.teatroGhetto, 3],
    [romeStopIds.trastevere, 3],
  ]);
  assert.deepEqual(
    romeTrip.stops
      .filter(({ visitPlan }) => visitPlan !== undefined)
      .map(({ id }) => id),
    [...planned.keys()],
  );
  const globalIds = new Set(romeTrip.stops.map(({ id }) => String(id)));
  for (const [stopId, count] of planned) {
    const items = orderedStopVisitPlanItems(stop(stopId).visitPlan!);
    assert.equal(items.length, count);
    assert.deepEqual(
      items.map(({ order }) => order),
      Array.from({ length: count }, (_, index) => (index + 1) * 10),
    );
    assert.equal(
      items.some(({ id }) => globalIds.has(String(id))),
      false,
    );
  }
  const initial = createInitialTripExecutionState(romeTrip, initializedAt);
  const map = deriveRouteMapView(romeTrip, initial);
  assert.equal(
    Object.keys(initial.stopExecutions).length,
    romeTrip.stops.length,
  );
  assert.equal(map.stops.length, romeTrip.days[0].plan.length);
});

void test('validation, ownership, and day-local map numbering cover every global Stop', () => {
  assert.deepEqual(validateTrip(romeTrip), { valid: true, errors: [] });
  const placements = romeTrip.days.flatMap((day) =>
    day.plan.map(({ stopId }) => [stopId, day.id] as const),
  );
  assert.equal(placements.length, romeTrip.stops.length);
  assert.equal(
    new Set(placements.map(([stopId]) => stopId)).size,
    placements.length,
  );
  for (const [stopId, dayId] of placements) {
    assert.equal(originalPlannedDayId(romeTrip, stopId), dayId);
  }

  const active = startedDay1();
  const before = structuredClone(active);
  const day1Map = deriveRouteMapView(romeTrip, active);
  const day2Map = deriveDayPreviewRouteMapView(
    romeTrip,
    active,
    romeDayIds.day2,
  );
  assert.deepEqual(
    day1Map.stops.map(({ itineraryPosition }) => itineraryPosition),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    day2Map.stops.map(({ itineraryPosition }) => itineraryPosition),
    Array.from({ length: 9 }, (_, index) => index + 1),
  );
  assert.equal(active.executionDayId, romeDayIds.day1);
  assert.equal(active.currentStopId, romeStopIds.ciampinoAirport);
  assert.deepEqual(active, before);
});

void test('Scenario A: normal Day 1 completion persists and starts visible Day 2', () => {
  const active = startedDay1();
  assert.deepEqual(roundTrip(active), active);
  const day1Complete = completeActiveDay(active, 2);
  assert.deepEqual(tripExecutionLifecycle(romeTrip, day1Complete), {
    status: 'DAY_COMPLETE',
    dayId: romeDayIds.day1,
  });
  const restored = roundTrip(day1Complete);
  const overview = deriveTripOverviewPresentation(
    romeTrip,
    restored,
    romeDayIds.day2,
  );
  assert.equal(overview.days[0].lifecycleStatus, 'completed');
  assert.equal(overview.days[1].lifecycleStatus, 'upcoming');
  assert.equal(overview.days[1].plannedStopCount, 9);
  const switched = switchExecutionDay(
    romeTrip,
    restored,
    romeDayIds.day2,
    at(1_500),
    { status: 'known', minutes: 0 },
  );
  assert.equal(switched.status, 'switched');
  assert.equal(switched.state.currentStopId, romeStopIds.stPetersBasilica);
  assert.deepEqual(switched.state.completedDayIds, [romeDayIds.day1]);
  assert.deepEqual(
    switched.state.eventLog
      .filter(({ type }) => type === 'day_started' || type === 'day_completed')
      .map(({ type }) => type),
    ['day_started', 'day_completed', 'day_started'],
  );
});

void test('Scenario B: Day-2 Teatro Do Now completes on Day 1 and survives cross-day persistence', () => {
  let state = startedDay1();
  state = accepted(doNowStop(romeTrip, state, romeStopIds.teatroGhetto, at(2)));
  assert.equal(state.currentStopId, romeStopIds.ciampinoAirport);
  state = accepted(completeCurrentStop(romeTrip, state, at(3)));
  assert.equal(state.currentStopId, romeStopIds.teatroGhetto);
  state = accepted(completeCurrentStop(romeTrip, state, at(4)));
  assert.equal(
    state.stopExecutions[romeStopIds.teatroGhetto].completedOnDayId,
    romeDayIds.day1,
  );
  assert.equal(
    originalPlannedDayId(romeTrip, romeStopIds.teatroGhetto),
    romeDayIds.day2,
  );
  const preview = deriveTripOverviewPresentation(
    romeTrip,
    state,
    romeDayIds.day2,
  );
  const history = preview.days[1].stops.find(
    ({ stopId }) => stopId === romeStopIds.teatroGhetto,
  );
  assert.equal(history?.completedEarly, true);
  assert.equal(history?.itineraryPosition, 7);
  assert.equal(state.executionDayId, romeDayIds.day1);
  assert.equal(state.currentStopId, romeStopIds.spanishSteps);

  const day1Complete = completeActiveDay(state, 5);
  const switched = switchExecutionDay(
    romeTrip,
    day1Complete,
    romeDayIds.day2,
    at(1_500),
    { status: 'known', minutes: 0 },
  );
  assert.equal(switched.status, 'switched');
  assert.equal(
    projectedExecutionStopIds(romeTrip, switched.state).includes(
      romeStopIds.teatroGhetto,
    ),
    false,
  );
  const restored = roundTrip(switched.state);
  assert.equal(
    restored.stopExecutions[romeStopIds.teatroGhetto].completedOnDayId,
    romeDayIds.day1,
  );
  assert.deepEqual(restored.eventLog, switched.state.eventLog);
  assert.equal(
    restored.eventLog.some(
      (event) =>
        event.type === 'stop_do_now' &&
        event.stopId === romeStopIds.teatroGhetto &&
        event.executionDayId === romeDayIds.day1,
    ),
    true,
  );
});

void test('Scenario C: Day-2 Tiber Island Already Visited retains Day-1 attribution and Day-2 history', () => {
  let state = startedDay1();
  state = accepted(
    markAlreadyVisited(romeTrip, state, romeStopIds.tiberIsland, at(2)),
  );
  assert.equal(
    state.stopExecutions[romeStopIds.tiberIsland].status,
    'completed',
  );
  assert.equal(
    state.stopExecutions[romeStopIds.tiberIsland].completedOnDayId,
    romeDayIds.day1,
  );
  assert.equal(
    originalPlannedDayId(romeTrip, romeStopIds.tiberIsland),
    romeDayIds.day2,
  );
  const preview = deriveTripOverviewPresentation(
    romeTrip,
    state,
    romeDayIds.day2,
  );
  assert.equal(
    preview.days[1].stops.find(
      ({ stopId }) => stopId === romeStopIds.tiberIsland,
    )?.completedEarly,
    true,
  );
  const day1Complete = completeActiveDay(state, 3);
  const switched = switchExecutionDay(
    romeTrip,
    day1Complete,
    romeDayIds.day2,
    at(1_500),
    { status: 'unknown', reason: 'unavailable' },
  );
  assert.equal(switched.status, 'switched');
  assert.equal(
    projectedExecutionStopIds(romeTrip, switched.state).includes(
      romeStopIds.tiberIsland,
    ),
    false,
  );
  assert.equal(
    switched.state.eventLog.some(
      (event) =>
        event.type === 'stop_already_visited' &&
        event.stopId === romeStopIds.tiberIsland &&
        event.executionDayId === romeDayIds.day1,
    ),
    true,
  );
});

void test('Scenario D: Castel Sant’Angelo can move to trip-level For Later through canonical actions', () => {
  let state = startedDay1();
  state = accepted(
    doNowStop(romeTrip, state, romeStopIds.castelSantAngelo, at(2)),
  );
  state = accepted(completeCurrentStop(romeTrip, state, at(3)));
  assert.equal(state.currentStopId, romeStopIds.castelSantAngelo);
  state = accepted(saveCurrentForLater(romeTrip, state, at(4)));
  assert.deepEqual(state.stopExecutions[romeStopIds.castelSantAngelo], {
    stopId: romeStopIds.castelSantAngelo,
    status: 'pending',
    scheduledDayId: null,
  });
  assert.equal(
    pendingForLaterActionModels(romeTrip, state).some(
      ({ stopId }) => stopId === romeStopIds.castelSantAngelo,
    ),
    true,
  );
  assert.equal(
    originalPlannedDayId(romeTrip, romeStopIds.castelSantAngelo),
    romeDayIds.day1,
  );
  assert.deepEqual(
    state.eventLog.slice(-2).map(({ type }) => type),
    ['stop_completed', 'stop_saved_for_later'],
  );
});

void test('Scenario E: normal transitions create persistent zero-work Day 2 before explicit terminal End Day', () => {
  let state = startedDay1();
  let minute = 2;
  for (const stopId of orderedDayPlan(romeTrip.days[1])
    .map(({ stopId }) => stopId)
    .filter((stopId) => stopId !== romeStopIds.aventineKeyhole)) {
    state = accepted(markAlreadyVisited(romeTrip, state, stopId, at(minute)));
    minute += 1;
  }
  state = accepted(
    doNowStop(romeTrip, state, romeStopIds.aventineKeyhole, at(minute)),
  );
  minute += 1;
  state = accepted(completeCurrentStop(romeTrip, state, at(minute)));
  minute += 1;
  assert.equal(state.currentStopId, romeStopIds.aventineKeyhole);
  state = accepted(saveCurrentForLater(romeTrip, state, at(minute)));
  minute += 1;
  assert.equal(
    state.stopExecutions[romeStopIds.aventineKeyhole].scheduledDayId,
    null,
  );
  state = completeActiveDay(state, minute);
  assert.deepEqual(state.completedDayIds, [romeDayIds.day1]);

  const switched = switchExecutionDay(
    romeTrip,
    state,
    romeDayIds.day2,
    at(1_500),
    { status: 'unknown', reason: 'unavailable' },
  );
  assert.equal(switched.status, 'switched');
  const zero = switched.state;
  assert.equal(zero.executionDayId, romeDayIds.day2);
  assert.equal(zero.executionDayStartedAt, at(1_500));
  assert.equal(zero.currentStopId, undefined);
  assert.equal(zero.currentStepStartedAt, undefined);
  assert.equal(zero.currentInboundTravel, undefined);
  assert.deepEqual(zero.completedDayIds, [romeDayIds.day1]);
  assert.deepEqual(tripExecutionLifecycle(romeTrip, zero), {
    status: 'ACTIVE',
    dayId: romeDayIds.day2,
  });
  assert.equal(projectSchedule(romeTrip, zero, at(1_500)).status, 'inactive');

  const restored = roundTrip(zero);
  assert.deepEqual(restored.eventLog, zero.eventLog);
  const terminal = accepted(endDay(romeTrip, restored, at(1_501)));
  assert.deepEqual(terminal.completedDayIds, [
    romeDayIds.day1,
    romeDayIds.day2,
  ]);
  assert.equal(
    tripExecutionLifecycle(romeTrip, terminal).status,
    'TRIP_COMPLETE',
  );
  assert.deepEqual(
    terminal.eventLog.slice(-3).map(({ type }) => type),
    ['day_started', 'day_ended', 'day_completed'],
  );
  assert.equal(
    terminal.eventLog.some(({ type }) => type === 'stop_saved_for_later'),
    true,
  );
  assert.equal(
    terminal.eventLog.some(({ type }) => type === 'stop_already_visited'),
    true,
  );
  const postDayUrl = new URL(
    postDayGoogleMapsNavigationUrl(romeFiumicinoAirport),
  );
  assert.equal(postDayUrl.searchParams.get('destination'), '41.8003,12.2389');
  assert.equal(postDayUrl.searchParams.get('travelmode'), 'transit');
  const restoredTerminal = roundTrip(terminal);
  assert.equal(
    tripExecutionLifecycle(romeTrip, restoredTerminal).status,
    'TRIP_COMPLETE',
  );
  assert.deepEqual(restoredTerminal.completedDayIds, terminal.completedDayIds);
  assert.deepEqual(restoredTerminal.eventLog, terminal.eventLog);
});

void test('Copenhagen, Kraków, and persistence schema regressions remain exact', () => {
  assert.equal(copenhagenTrip.id, 'copenhagen');
  assert.equal(copenhagenTrip.days.length, 1);
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
  assert.equal(krakowField06Trip.id, 'krk-field06-structured-stop-visit-plan');
  assert.equal(krakowField06Trip.days.length, 1);
  assert.equal(krakowField06Trip.stops.length, 5);
  assert.equal(
    krakowField06Trip.stops.filter(({ visitPlan }) => visitPlan).length,
    1,
  );
  assert.deepEqual(validateTrip(krakowField06Trip), {
    valid: true,
    errors: [],
  });
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 3);
});
