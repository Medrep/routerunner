import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stopDetailsCtaModel,
  stopVisitContentModel,
} from '../../components/routerunner/stop-visit-content.ts';
import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  krakowField06Trip,
  krakowMitVisitPlanItemIds,
  krakowStopIds,
} from '../../data/trips/krakow.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  nextEligiblePendingStopId,
  startDay,
  type Stop,
  type Trip,
  type TripExecutionState,
} from '../index.ts';

const mit = krakowField06Trip.stops.find(
  ({ id }) => id === krakowStopIds.mitZajezdnia,
)!;

function preparedStop(prepared: Pick<Stop, 'visitBrief' | 'highlights'>): Stop {
  return {
    id: createStopId('prepared-stop'),
    name: 'Prepared stop',
    latitude: 50,
    longitude: 20,
    priority: 'normal',
    canSkip: true,
    plannedVisitMinutes: 10,
    ...prepared,
  };
}

function startedState(trip: Trip, now: string): TripExecutionState {
  const initial = createInitialTripExecutionState(trip, now);
  const started = startDay(trip, initial, trip.days[0].id, now);
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error('Expected Start Day to succeed.');
  return started.state;
}

function complete(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TripExecutionState {
  const result = completeCurrentStop(trip, state, now);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected Done to succeed.');
  return result.state;
}

void test('four-item and one-item visit plans derive canonical count-aware CTA copy', () => {
  assert.deepEqual(stopDetailsCtaModel(mit), {
    label: 'View 4 things inside',
    detailStopId: krakowStopIds.mitZajezdnia,
  });

  const oneItemStop: Stop = {
    ...mit,
    id: createStopId('one-item-stop'),
    visitPlan: { items: mit.visitPlan!.items.slice(0, 1) },
  };
  assert.deepEqual(stopDetailsCtaModel(oneItemStop), {
    label: 'View 1 thing inside',
    detailStopId: oneItemStop.id,
  });
});

void test('ordinary visitBrief-only and highlights-only Stops derive View details', () => {
  const briefOnly = preparedStop({ visitBrief: 'Prepared context.' });
  const highlightsOnly = preparedStop({ highlights: ['Prepared highlight'] });

  assert.deepEqual(stopDetailsCtaModel(briefOnly), {
    label: 'View details',
    detailStopId: briefOnly.id,
  });
  assert.deepEqual(stopDetailsCtaModel(highlightsOnly), {
    label: 'View details',
    detailStopId: highlightsOnly.id,
  });
});

void test('a Stop without meaningful prepared content has no CTA or empty content model', () => {
  const empty = preparedStop({});
  const invalidEmptyPlan: Stop = { ...empty, visitPlan: { items: [] } };

  assert.equal(stopDetailsCtaModel(empty), null);
  assert.equal(stopVisitContentModel(empty, 'current'), null);
  assert.equal(stopVisitContentModel(empty, 'details'), null);
  assert.equal(stopDetailsCtaModel(invalidEmptyPlan), null);
  assert.equal(stopVisitContentModel(invalidEmptyPlan, 'current'), null);
  assert.equal(stopVisitContentModel(invalidEmptyPlan, 'details'), null);
  assert.equal(
    JSON.stringify(stopDetailsCtaModel(invalidEmptyPlan)).includes(
      'View 0 things inside',
    ),
    false,
  );
});

void test('MIT Current keeps parent content compact while its CTA targets existing Details', () => {
  let execution = startedState(krakowField06Trip, '2026-09-12T07:00:00.000Z');
  execution = complete(
    krakowField06Trip,
    execution,
    '2026-09-12T07:15:00.000Z',
  );
  const before = structuredClone(execution);
  const current = krakowField06Trip.stops.find(
    ({ id }) => id === execution.currentStopId,
  )!;
  const currentContent = stopVisitContentModel(current, 'current');
  const cta = stopDetailsCtaModel(current);

  assert.equal(current.id, krakowStopIds.mitZajezdnia);
  assert.match(currentContent?.visitBrief ?? '', /ordered attention plan/);
  assert.equal(currentContent?.visitPlanItemCount, 4);
  assert.equal(currentContent?.visitPlanItems, undefined);
  assert.equal(cta?.label, 'View 4 things inside');
  assert.equal(cta?.detailStopId, current.id);
  assert.deepEqual(
    stopVisitContentModel(
      krakowField06Trip.stops.find(({ id }) => id === cta?.detailStopId)!,
      'details',
    )?.visitPlanItems?.map(({ id }) => id),
    Object.values(krakowMitVisitPlanItemIds),
  );
  assert.equal(execution.currentStopId, krakowStopIds.mitZajezdnia);
  assert.equal(
    nextEligiblePendingStopId(krakowField06Trip, execution),
    krakowStopIds.halaTargowa,
  );
  assert.deepEqual(execution, before);
});

void test('Done MIT still advances to Hala Targowa after CTA derivation', () => {
  let execution = startedState(krakowField06Trip, '2026-09-12T07:00:00.000Z');
  execution = complete(
    krakowField06Trip,
    execution,
    '2026-09-12T07:15:00.000Z',
  );
  stopDetailsCtaModel(mit);
  execution = complete(
    krakowField06Trip,
    execution,
    '2026-09-12T09:15:00.000Z',
  );

  assert.equal(execution.currentStopId, krakowStopIds.halaTargowa);
  assert.equal(
    execution.stopExecutions[krakowStopIds.mitZajezdnia].status,
    'completed',
  );
  for (const internalId of Object.values(krakowMitVisitPlanItemIds)) {
    assert.equal(Object.hasOwn(execution.stopExecutions, internalId), false);
  }
});

void test('Copenhagen execution remains unchanged by ordinary Details CTA derivation', () => {
  let execution = startedState(copenhagenTrip, '2026-09-08T08:30:00.000Z');
  const before = structuredClone(execution);
  const nyhavn = copenhagenTrip.stops.find(
    ({ id }) => id === copenhagenStopIds.nyhavn,
  )!;

  assert.deepEqual(stopDetailsCtaModel(nyhavn), {
    label: 'View details',
    detailStopId: copenhagenStopIds.nyhavn,
  });
  assert.deepEqual(execution, before);
  assert.equal(execution.currentStopId, copenhagenStopIds.nyhavn);
  assert.equal(
    nextEligiblePendingStopId(copenhagenTrip, execution),
    copenhagenStopIds.amalienborg,
  );

  execution = complete(copenhagenTrip, execution, '2026-09-08T08:50:00.000Z');
  assert.equal(execution.currentStopId, copenhagenStopIds.amalienborg);
});
