import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  dayPlanPresentationModel,
  plannedStopPresentation,
} from '../../components/routerunner/day-plan-presentation.ts';
import { stopDetailsCtaModel } from '../../components/routerunner/stop-visit-content.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  krakowField06Trip,
  krakowMitVisitPlanItemIds,
  krakowStopIds,
} from '../../data/trips/krakow.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  EXECUTION_STATE_SCHEMA_VERSION,
  executionStorageKey,
  nextEligiblePendingStopId,
  saveExecutionState,
  startDay,
  validateTrip,
  type DayPlanItem,
  type ExecutionStorage,
  type Stop,
  type StopVisitPlanItem,
  type Trip,
  type TripExecutionState,
} from '../index.ts';

type HasPlannedStartTime<Value> = 'plannedStartTime' extends keyof Value
  ? true
  : false;

const dayPlanItemOwnsPlannedStartTime: HasPlannedStartTime<DayPlanItem> = true;
const stopDoesNotOwnPlannedStartTime: HasPlannedStartTime<Stop> = false;
const internalItemDoesNotOwnPlannedStartTime: HasPlannedStartTime<StopVisitPlanItem> = false;
const executionDoesNotOwnPlannedStartTime: HasPlannedStartTime<TripExecutionState> = false;

const initializedAt = '2026-09-12T10:55:00.000Z';
const startedAt = '2026-09-12T11:00:00.000Z';

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

function withFirstPlannedTime(value: string): Trip {
  const [firstDay, ...remainingDays] = copenhagenTrip.days;
  const [firstItem, ...remainingItems] = firstDay.plan;

  return {
    ...copenhagenTrip,
    days: [
      {
        ...firstDay,
        plan: [{ ...firstItem, plannedStartTime: value }, ...remainingItems],
      },
      ...remainingDays,
    ],
  };
}

function startedKrakowState(): TripExecutionState {
  const initial = createInitialTripExecutionState(
    krakowField06Trip,
    initializedAt,
  );
  const started = startDay(
    krakowField06Trip,
    initial,
    krakowField06Trip.days[0].id,
    startedAt,
  );
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error('Expected Kraków day to start.');
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

void test('DayPlanItem planned start is optional and uses existing local HH:mm validation', () => {
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
  assert.equal(
    copenhagenTrip.days[0].plan.every(
      (item) => !Object.hasOwn(item, 'plannedStartTime'),
    ),
    true,
  );

  const valid = withFirstPlannedTime('09:05');
  assert.deepEqual(validateTrip(valid), { valid: true, errors: [] });
  assert.equal(valid.days[0].plan[0].plannedStartTime, '09:05');
});

for (const [name, value] of [
  ['malformed value', '9:05'],
  ['impossible hour', '24:00'],
  ['impossible minute', '12:60'],
] as const) {
  void test(`rejects ${name} without repairing or mutating the supplied value`, () => {
    const trip = withFirstPlannedTime(value);
    const before = structuredClone(trip);
    const result = validateTrip(trip);

    assert.deepEqual(result, {
      valid: false,
      errors: [
        {
          code: 'INVALID_TIME',
          path: 'days[0].plan[0].plannedStartTime',
          message: 'Expected a local time in HH:mm format.',
        },
      ],
    });
    assert.equal(trip.days[0].plan[0].plannedStartTime, value);
    assert.deepEqual(trip, before);
  });
}

void test('multiple placements keep independent valid clock times without ordering constraints', () => {
  const trip = withFirstPlannedTime('14:00');
  const firstDay = trip.days[0];
  trip.days = [
    {
      ...firstDay,
      plan: [
        firstDay.plan[0],
        { ...firstDay.plan[1], plannedStartTime: '13:00' },
        ...firstDay.plan.slice(2),
      ],
    },
  ];

  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
  assert.deepEqual(
    trip.days[0].plan.slice(0, 2).map((item) => item.plannedStartTime),
    ['14:00', '13:00'],
  );
});

void test('planned start ownership excludes Stop, internal items, and execution state', () => {
  assert.equal(dayPlanItemOwnsPlannedStartTime, true);
  assert.equal(stopDoesNotOwnPlannedStartTime, false);
  assert.equal(internalItemDoesNotOwnPlannedStartTime, false);
  assert.equal(executionDoesNotOwnPlannedStartTime, false);
  assert.equal(
    krakowField06Trip.stops.some((stop) =>
      Object.hasOwn(stop, 'plannedStartTime'),
    ),
    false,
  );

  const state = startedKrakowState();
  assert.equal(JSON.stringify(state).includes('plannedStartTime'), false);
});

void test('Kraków defines exactly five global planned times in canonical order', () => {
  const model = dayPlanPresentationModel(
    krakowField06Trip.days[0],
    krakowField06Trip.stops,
  );

  assert.deepEqual(validateTrip(krakowField06Trip), {
    valid: true,
    errors: [],
  });
  assert.equal(
    krakowField06Trip.days[0].plan.filter((item) =>
      Object.hasOwn(item, 'plannedStartTime'),
    ).length,
    5,
  );
  assert.deepEqual(
    model.map(({ stop, plannedStartTime }) => ({
      name: stop.name,
      plannedStartTime,
    })),
    [
      { name: 'Plac Wolnica', plannedStartTime: '13:00' },
      {
        name: 'Muzeum Inżynierii i Techniki — Zajezdnia',
        plannedStartTime: '13:10',
      },
      { name: 'Hala Targowa', plannedStartTime: '14:55' },
      { name: 'Rondo Grzegórzeckie', plannedStartTime: '15:15' },
      { name: 'Kraków Główny', plannedStartTime: '15:35' },
    ],
  );
});

void test('MIT internal items have no planned start fields', () => {
  const mit = krakowField06Trip.stops.find(
    ({ id }) => id === krakowStopIds.mitZajezdnia,
  )!;

  assert.equal(mit.visitPlan?.items.length, 4);
  assert.deepEqual(
    mit.visitPlan?.items.map(({ id }) => id),
    Object.values(krakowMitVisitPlanItemIds),
  );
  assert.equal(
    mit.visitPlan?.items.some((item) =>
      Object.hasOwn(item, 'plannedStartTime'),
    ),
    false,
  );
});

void test('Current and Next resolve their times from the unchanged active day placements', () => {
  const model = dayPlanPresentationModel(
    krakowField06Trip.days[0],
    krakowField06Trip.stops,
  );
  const before = structuredClone(krakowField06Trip);
  const mitCurrent = complete(startedKrakowState(), '2026-09-12T11:10:00.000Z');
  const nextStopId = nextEligiblePendingStopId(krakowField06Trip, mitCurrent);

  assert.equal(mitCurrent.currentStopId, krakowStopIds.mitZajezdnia);
  assert.equal(
    plannedStopPresentation(model, mitCurrent.currentStopId)?.plannedStartTime,
    '13:10',
  );
  assert.equal(nextStopId, krakowStopIds.halaTargowa);
  assert.equal(
    plannedStopPresentation(model, nextStopId)?.plannedStartTime,
    '14:55',
  );
  assert.deepEqual(krakowField06Trip, before);
});

void test('MIT Details CTA remains explicit and Done still advances to Hala Targowa', () => {
  const mit = krakowField06Trip.stops.find(
    ({ id }) => id === krakowStopIds.mitZajezdnia,
  )!;
  let state = complete(startedKrakowState(), '2026-09-12T11:10:00.000Z');

  assert.deepEqual(stopDetailsCtaModel(mit), {
    label: 'View 4 things inside',
    detailStopId: krakowStopIds.mitZajezdnia,
  });
  state = complete(state, '2026-09-12T13:10:00.000Z');
  assert.equal(state.currentStopId, krakowStopIds.halaTargowa);
});

void test('execution persistence remains version 1 and excludes static planned times', () => {
  const storage = new MemoryStorage();
  const state = complete(startedKrakowState(), '2026-09-12T11:10:00.000Z');
  const result = saveExecutionState(
    krakowField06Trip,
    state,
    state.lastUpdatedAt,
    storage,
  );
  const serialized = storage.getItem(executionStorageKey(krakowField06Trip.id));

  assert.equal(result.status, 'saved');
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 1);
  assert.ok(serialized);
  assert.equal(serialized.includes('plannedStartTime'), false);
  assert.equal(serialized.includes('13:10'), false);
});

void test('Copenhagen stays valid without global planned start times', () => {
  const model = dayPlanPresentationModel(
    copenhagenTrip.days[0],
    copenhagenTrip.stops,
  );

  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
  assert.equal(model.length, copenhagenTrip.days[0].plan.length);
  assert.equal(
    model.some((item) => Object.hasOwn(item, 'plannedStartTime')),
    false,
  );
});

void test('RR-FIELD-07A production changes contain no schedule-deviation logic', () => {
  const sources = [
    '../../app/page.tsx',
    '../../components/routerunner/day-plan-presentation.ts',
    '../trip/types.ts',
    '../trip/validate-trip.ts',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));
  const source = sources.join('\n');

  assert.doesNotMatch(
    source,
    /\b(?:aheadMinutes|lateMinutes|actualStartTime|arrivalTimestamp)\b|Date\.now\(/,
  );
  assert.doesNotMatch(source, /['"](?:Ahead|Late|On time)['"]/);
});
