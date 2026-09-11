import assert from 'node:assert/strict';
import test from 'node:test';

import { stopVisitContentModel } from '../../components/routerunner/stop-visit-content.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  selectTrip,
  selectableTrips,
  selectTripFromSearch,
  tripSelectionHref,
} from '../../data/trips/index.ts';
import {
  krakowField06Trip,
  krakowMitVisitPlanItemIds,
  krakowStopIds,
} from '../../data/trips/krakow.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  deriveRouteMapView,
  EXECUTION_STATE_SCHEMA_VERSION,
  executionStorageKey,
  loadExecutionState,
  nextEligiblePendingStopId,
  orderedStopVisitPlanItems,
  saveExecutionState,
  startDay,
  validateTrip,
  type ExecutionStorage,
  type TripExecutionState,
} from '../index.ts';

const initializedAt = '2026-09-12T07:00:00.000Z';
const startedAt = '2026-09-12T07:05:00.000Z';

class MemoryStorage implements ExecutionStorage {
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

function startedKrakowState(): TripExecutionState {
  const started = startDay(
    krakowField06Trip,
    createInitialTripExecutionState(krakowField06Trip, initializedAt),
    krakowField06Trip.days[0].id,
    startedAt,
  );
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error('Expected the Kraków day to start.');
  return started.state;
}

function complete(
  state: TripExecutionState,
  timestamp: string,
): TripExecutionState {
  const result = completeCurrentStop(krakowField06Trip, state, timestamp);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected Current to complete.');
  return result.state;
}

void test('Kraków fixture validates with five global Stops and one five-item Day plan', () => {
  assert.deepEqual(validateTrip(krakowField06Trip), {
    valid: true,
    errors: [],
  });
  assert.equal(krakowField06Trip.id, 'krk-field06-structured-stop-visit-plan');
  assert.equal(
    krakowField06Trip.title,
    'Kraków · Structured Stop Visit Plan Field Test',
  );
  assert.equal(krakowField06Trip.timeZone, 'Europe/Warsaw');
  assert.equal(krakowField06Trip.startDate, '2026-09-12');
  assert.equal(krakowField06Trip.endDate, '2026-09-12');
  assert.equal(krakowField06Trip.stops.length, 5);
  assert.equal(krakowField06Trip.days.length, 1);
  assert.equal(krakowField06Trip.days[0].plan.length, 5);
  assert.deepEqual(
    krakowField06Trip.days[0].plan.map(({ order }) => order),
    [10, 20, 30, 40, 50],
  );
  assert.deepEqual(
    krakowField06Trip.stops.map(({ name }) => name),
    [
      'Plac Wolnica',
      'Muzeum Inżynierii i Techniki — Zajezdnia',
      'Hala Targowa',
      'Rondo Grzegórzeckie',
      'Kraków Główny',
    ],
  );
});

void test('MIT is one global Stop with four branded, canonically ordered internal items', () => {
  const mitStops = krakowField06Trip.stops.filter(
    ({ id }) => id === krakowStopIds.mitZajezdnia,
  );
  const mitPlanItems = orderedStopVisitPlanItems(mitStops[0].visitPlan!);
  const internalIds = new Set(
    Object.values(krakowMitVisitPlanItemIds).map(String),
  );

  assert.equal(mitStops.length, 1);
  assert.equal(
    krakowField06Trip.days[0].plan.filter(
      ({ stopId }) => stopId === krakowStopIds.mitZajezdnia,
    ).length,
    1,
  );
  assert.equal(mitPlanItems.length, 4);
  assert.deepEqual(
    mitPlanItems.map(({ order, name }) => ({ order, name })),
    [
      { order: 10, name: 'City systems' },
      { order: 20, name: 'Movement & urban form' },
      { order: 30, name: 'Communication & computing' },
      { order: 40, name: 'LAB & historic trams' },
    ],
  );
  assert.ok(
    krakowField06Trip.stops.every(({ id }) => !internalIds.has(String(id))),
  );
  assert.ok(
    krakowField06Trip.days[0].plan.every(
      ({ stopId }) => !internalIds.has(String(stopId)),
    ),
  );
});

void test('MIT prepared item briefs and highlights are preserved by the Details model', () => {
  const mit = krakowField06Trip.stops.find(
    ({ id }) => id === krakowStopIds.mitZajezdnia,
  )!;
  const details = stopVisitContentModel(mit, 'details');

  assert.deepEqual(
    details?.visitPlanItems?.map(({ order, name, visitBrief, highlights }) => ({
      order,
      name,
      visitBrief,
      highlights,
    })),
    [
      {
        order: 10,
        name: 'City systems',
        visitBrief:
          'Start with the systems that keep a city running: water, energy, heating and related infrastructure.',
        highlights: [
          'Hydrotechnology',
          'Energy engineering',
          'Heat and gas engineering',
        ],
      },
      {
        order: 20,
        name: 'Movement & urban form',
        visitBrief:
          'Focus next on how technology shapes the physical city and how people move through it.',
        highlights: ['Architecture', 'Urban planning', 'Mobility'],
      },
      {
        order: 30,
        name: 'Communication & computing',
        visitBrief:
          'Look for the progression from early communication equipment to electronic computing.',
        highlights: [
          'Early Polish telephones',
          'Historic radio equipment',
          'Odra 1305 computer',
        ],
      },
      {
        order: 40,
        name: 'LAB & historic trams',
        visitBrief:
          'Finish with a few hands-on LAB experiments and the historic tram collection before leaving the museum.',
        highlights: ['LAB experiments', 'Historic tram cars'],
      },
    ],
  );
  assert.equal(details?.visitPlanItemCount, undefined);
  for (const item of details?.visitPlanItems ?? []) {
    assert.equal(Object.hasOwn(item, 'status'), false);
    assert.equal(Object.hasOwn(item, 'canSkip'), false);
    assert.equal(Object.hasOwn(item, 'done'), false);
    assert.equal(Object.hasOwn(item, 'skip'), false);
  }
});

void test('Current keeps MIT as one parent Stop and exposes only the compact plan count', () => {
  let state = startedKrakowState();
  assert.equal(state.currentStopId, krakowStopIds.placWolnica);
  assert.equal(
    nextEligiblePendingStopId(krakowField06Trip, state),
    krakowStopIds.mitZajezdnia,
  );

  state = complete(state, '2026-09-12T07:15:00.000Z');
  assert.equal(state.currentStopId, krakowStopIds.mitZajezdnia);
  assert.equal(
    nextEligiblePendingStopId(krakowField06Trip, state),
    krakowStopIds.halaTargowa,
  );

  const mit = krakowField06Trip.stops.find(
    ({ id }) => id === state.currentStopId,
  )!;
  const current = stopVisitContentModel(mit, 'current');
  assert.match(current?.visitBrief ?? '', /ordered attention plan/);
  assert.equal(current?.visitPlanItemCount, 4);
  assert.equal(current?.visitPlanItems, undefined);
  assert.equal(Object.keys(state.stopExecutions).length, 5);
  for (const internalId of Object.values(krakowMitVisitPlanItemIds)) {
    assert.equal(Object.hasOwn(state.stopExecutions, internalId), false);
  }
});

void test('Done on MIT advances directly to Hala Targowa with no internal execution gate', () => {
  let state = complete(startedKrakowState(), '2026-09-12T07:15:00.000Z');
  state = complete(state, '2026-09-12T09:15:00.000Z');

  assert.equal(
    state.stopExecutions[krakowStopIds.mitZajezdnia].status,
    'completed',
  );
  assert.equal(state.currentStopId, krakowStopIds.halaTargowa);
  assert.equal(
    nextEligiblePendingStopId(krakowField06Trip, state),
    krakowStopIds.rondoGrzegorzeckie,
  );

  state = complete(state, '2026-09-12T09:30:00.000Z');
  assert.equal(state.currentStopId, krakowStopIds.rondoGrzegorzeckie);
});

void test('Kraków map has five numbered global markers and four global Legs only', () => {
  const mapView = deriveRouteMapView(krakowField06Trip, startedKrakowState());
  const globalStopIds = new Set(krakowField06Trip.stops.map(({ id }) => id));
  const internalIds = new Set(
    Object.values(krakowMitVisitPlanItemIds).map(String),
  );

  assert.equal(mapView.stops.length, 5);
  assert.deepEqual(
    mapView.stops.map(({ itineraryPosition }) => itineraryPosition),
    [1, 2, 3, 4, 5],
  );
  assert.equal(krakowField06Trip.legs?.length, 4);
  assert.equal(mapView.legs.length, 4);
  assert.deepEqual(
    krakowField06Trip.legs?.map(({ mode }) => mode),
    ['walk', 'walk', 'walk', 'transit'],
  );
  for (const leg of krakowField06Trip.legs ?? []) {
    assert.ok(globalStopIds.has(leg.fromStopId));
    assert.ok(globalStopIds.has(leg.toStopId));
    assert.equal(internalIds.has(String(leg.fromStopId)), false);
    assert.equal(internalIds.has(String(leg.toStopId)), false);
    assert.equal(leg.plannedDurationMinutes, undefined);
    assert.equal(leg.distanceMeters, undefined);
    assert.equal(leg.geometry, undefined);
    assert.equal(leg.navigationWaypoints, undefined);
  }
  assert.deepEqual(mapView.navigationViaPoints, []);
});

void test('execution persistence excludes MIT internal items and stays isolated by Trip ID', () => {
  const storage = new MemoryStorage();
  const krakowState = complete(
    complete(startedKrakowState(), '2026-09-12T07:15:00.000Z'),
    '2026-09-12T09:15:00.000Z',
  );
  const copenhagenState = createInitialTripExecutionState(
    copenhagenTrip,
    '2026-09-08T08:00:00.000Z',
  );

  assert.equal(
    saveExecutionState(
      krakowField06Trip,
      krakowState,
      krakowState.lastUpdatedAt,
      storage,
    ).status,
    'saved',
  );
  assert.equal(
    saveExecutionState(
      copenhagenTrip,
      copenhagenState,
      copenhagenState.lastUpdatedAt,
      storage,
    ).status,
    'saved',
  );

  const krakowKey = executionStorageKey(krakowField06Trip.id);
  const copenhagenKey = executionStorageKey(copenhagenTrip.id);
  const serializedKrakow = storage.getItem(krakowKey)!;
  assert.notEqual(krakowKey, copenhagenKey);
  assert.equal(storage.values.size, 2);
  assert.equal(
    loadExecutionState(krakowField06Trip, storage).status,
    'restored',
  );
  assert.equal(loadExecutionState(copenhagenTrip, storage).status, 'restored');
  assert.equal(krakowState.currentStopId, krakowStopIds.halaTargowa);
  assert.equal(serializedKrakow.includes('visitPlan'), false);
  for (const internalId of Object.values(krakowMitVisitPlanItemIds)) {
    assert.equal(serializedKrakow.includes(internalId), false);
  }
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 3);
});

void test('private-test trip selection defaults to Copenhagen and distinguishes Kraków', () => {
  assert.deepEqual(
    selectableTrips.map(({ trip }) => trip.id),
    [copenhagenTrip.id, krakowField06Trip.id],
  );
  assert.equal(selectTrip(undefined), copenhagenTrip);
  assert.equal(selectTrip('unknown'), copenhagenTrip);
  assert.equal(selectTrip(krakowField06Trip.id), krakowField06Trip);
  assert.equal(selectTripFromSearch(''), copenhagenTrip);
  assert.equal(
    selectTripFromSearch(`?trip=${krakowField06Trip.id}`),
    krakowField06Trip,
  );
  assert.equal(
    tripSelectionHref(krakowField06Trip.id),
    '?trip=krk-field06-structured-stop-visit-plan',
  );
});

void test('Copenhagen remains valid and retains its established fixture boundary', () => {
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
  assert.equal(copenhagenTrip.id, 'copenhagen');
  assert.equal(copenhagenTrip.title, 'Copenhagen');
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.equal(copenhagenTrip.days[0].plan.length, 16);
  assert.equal(copenhagenTrip.legs?.length, 16);
  assert.ok(
    copenhagenTrip.stops.every(({ visitPlan }) => visitPlan === undefined),
  );
});
