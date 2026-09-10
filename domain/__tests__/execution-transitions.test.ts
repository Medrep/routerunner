import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  nextEligiblePendingStopId,
  originalPlannedDayId,
  saveCurrentForLater,
  skipCurrentStop,
  startDay,
  validateTrip,
} from '../index.ts';
import type { DayPlanItem, Trip, TripExecutionState } from '../index.ts';

const dayId = 'copenhagen-day-1';
const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:05:00.000Z';

function tripWithPlan(plan: DayPlanItem[]): Trip {
  return {
    ...copenhagenTrip,
    days: [{ ...copenhagenTrip.days[0], plan }],
    rules: copenhagenTrip.rules?.map((rule) => ({ ...rule, dayId })),
  };
}

function initialState(trip: Trip = copenhagenTrip) {
  return createInitialTripExecutionState(trip, initializedAt);
}

function activeState(trip: Trip = copenhagenTrip) {
  const result = startDay(trip, initialState(trip), dayId, startedAt);
  assert.equal(result.ok, true);
  return result.state;
}

function snapshot(value: unknown) {
  return structuredClone(value);
}

void test('initializes one pending execution per sightseeing stop from static planning', () => {
  const tripBefore = snapshot(copenhagenTrip);
  const state = initialState();

  assert.equal(Object.keys(state.stopExecutions).length, 16);
  assert.deepEqual(
    Object.keys(state.stopExecutions),
    copenhagenTrip.stops.map((stop) => stop.id),
  );
  assert.ok(
    Object.values(state.stopExecutions).every(
      (execution) =>
        execution.status === 'pending' &&
        execution.scheduledDayId === dayId &&
        execution.completedRecordedAt === undefined &&
        execution.completedOnDayId === undefined,
    ),
  );
  assert.equal(
    String(copenhagenTrip.days[0].postDayDestination!.id) in
      state.stopExecutions,
    false,
  );
  assert.equal(state.executionDayId, undefined);
  assert.equal(state.currentStopId, undefined);
  assert.equal(state.currentInboundTravel, undefined);
  assert.deepEqual(state.doNowQueue, []);
  assert.deepEqual(state.completedDayIds, []);
  assert.deepEqual(state.ruleAcknowledgements, []);
  assert.equal(state.lastUpdatedAt, initializedAt);
  assert.deepEqual(copenhagenTrip, tripBefore);
});

void test('preserves null scheduling for a valid stop outside every day plan', () => {
  const unscheduledTrip = {
    ...copenhagenTrip,
    days: [
      {
        ...copenhagenTrip.days[0],
        plan: copenhagenTrip.days[0].plan.slice(0, -1),
      },
    ],
  };

  const state = createInitialTripExecutionState(unscheduledTrip, initializedAt);
  assert.equal(
    state.stopExecutions[copenhagenStopIds.torvehallerne].scheduledDayId,
    null,
  );
});

void test('starts Copenhagen Day 1 at Nyhavn without completing any stop', () => {
  const input = initialState();
  const before = snapshot(input);
  const result = startDay(copenhagenTrip, input, dayId, startedAt);

  assert.equal(result.ok, true);
  assert.equal(result.state.executionDayId, dayId);
  assert.equal(result.state.executionDayStartedAt, startedAt);
  assert.equal(result.state.currentStopId, copenhagenStopIds.nyhavn);
  assert.equal(result.state.currentStepStartedAt, startedAt);
  assert.deepEqual(result.state.currentInboundTravel, {
    fromStopId: null,
    toStopId: copenhagenStopIds.nyhavn,
    duration: { status: 'unknown', reason: 'unresolved' },
  });
  assert.equal('minutes' in result.state.currentInboundTravel!.duration, false);
  assert.ok(
    Object.values(result.state.stopExecutions).every(
      (execution) => execution.status === 'pending',
    ),
  );
  assert.deepEqual(input, before);
});

void test('unsorted plan uses numeric order for Start, Done, Skip, and Save for Later', () => {
  const reversedPlan = [...copenhagenTrip.days[0].plan].reverse();
  const trip = tripWithPlan(reversedPlan);
  const physicalOrderBefore = snapshot(trip.days[0].plan);
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });

  const started = startDay(trip, initialState(trip), dayId, startedAt);
  assert.equal(started.ok, true);
  assert.equal(started.state.currentStopId, copenhagenStopIds.nyhavn);
  const startedBefore = snapshot(started.state);

  const transitions = [
    completeCurrentStop(trip, started.state, startedAt),
    skipCurrentStop(trip, started.state, startedAt),
    saveCurrentForLater(trip, started.state, startedAt),
  ];
  for (const result of transitions) {
    assert.equal(result.ok, true);
    assert.equal(result.state.currentStopId, copenhagenStopIds.amalienborg);
  }

  assert.deepEqual(started.state, startedBefore);
  assert.deepEqual(trip.days[0].plan, physicalOrderBefore);
});

void test('sparse numeric orders execute canonically without requiring contiguous values', () => {
  const [nyhavn, amalienborg, marbleChurch] = copenhagenTrip.days[0].plan;
  const sparsePhysicalPlan = [
    { ...marbleChurch, order: 70 },
    { ...nyhavn, order: 10 },
    { ...amalienborg, order: 30 },
  ];
  const trip = { ...tripWithPlan(sparsePhysicalPlan), rules: undefined };
  const physicalOrderBefore = snapshot(trip.days[0].plan);
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });

  let state = activeState(trip);
  assert.equal(state.currentStopId, copenhagenStopIds.nyhavn);
  let result = completeCurrentStop(trip, state, startedAt);
  assert.equal(result.ok, true);
  state = result.state;
  assert.equal(state.currentStopId, copenhagenStopIds.amalienborg);
  result = completeCurrentStop(trip, state, startedAt);
  assert.equal(result.ok, true);
  assert.equal(result.state.currentStopId, copenhagenStopIds.marbleChurch);
  assert.deepEqual(trip.days[0].plan, physicalOrderBefore);
});

void test('ordered advancement and presentation Next skip ineligible entries', () => {
  const dayOne = {
    ...copenhagenTrip.days[0],
    plan: [...copenhagenTrip.days[0].plan].reverse(),
  };
  const trip: Trip = {
    ...copenhagenTrip,
    endDate: '2026-09-09',
    days: [dayOne, { id: 'copenhagen-day-2', date: '2026-09-09', plan: [] }],
  };
  const physicalOrderBefore = snapshot(dayOne.plan);
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });

  const active = activeState(trip);
  const state: TripExecutionState = {
    ...active,
    stopExecutions: {
      ...active.stopExecutions,
      [copenhagenStopIds.amalienborg]: {
        ...active.stopExecutions[copenhagenStopIds.amalienborg],
        status: 'completed',
      },
      [copenhagenStopIds.marbleChurch]: {
        ...active.stopExecutions[copenhagenStopIds.marbleChurch],
        status: 'skipped',
      },
      [copenhagenStopIds.gefionFountain]: {
        ...active.stopExecutions[copenhagenStopIds.gefionFountain],
        status: 'completed',
      },
      [copenhagenStopIds.kastellet]: {
        ...active.stopExecutions[copenhagenStopIds.kastellet],
        scheduledDayId: null,
      },
      [copenhagenStopIds.littleMermaid]: {
        ...active.stopExecutions[copenhagenStopIds.littleMermaid],
        scheduledDayId: 'copenhagen-day-2',
      },
    },
  };

  assert.equal(
    nextEligiblePendingStopId(trip, state),
    copenhagenStopIds.reffen,
  );
  const result = completeCurrentStop(trip, state, startedAt);
  assert.equal(result.ok, true);
  assert.equal(result.state.currentStopId, copenhagenStopIds.reffen);
  assert.deepEqual(dayOne.plan, physicalOrderBefore);
});

void test('rejects unknown, mismatched, completed, and concurrently active day starts', () => {
  const input = initialState();
  const unknown = startDay(copenhagenTrip, input, 'missing-day', startedAt);
  assert.deepEqual(unknown, {
    ok: false,
    error: {
      code: 'DAY_NOT_FOUND',
      message: 'Day missing-day does not exist.',
    },
  });

  const mismatch = startDay(
    copenhagenTrip,
    { ...input, tripId: 'another-trip' },
    dayId,
    startedAt,
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'TRIP_STATE_MISMATCH');

  const completed = startDay(
    copenhagenTrip,
    { ...input, completedDayIds: [dayId] },
    dayId,
    startedAt,
  );
  assert.equal(completed.ok, false);
  assert.equal(completed.error.code, 'TRIP_COMPLETE');

  const tripWithAnotherDay = {
    ...copenhagenTrip,
    endDate: '2026-09-09',
    days: [
      ...copenhagenTrip.days,
      { id: 'copenhagen-day-2', date: '2026-09-09', plan: [] },
    ],
  };
  const active = startDay(
    tripWithAnotherDay,
    activeState(),
    'copenhagen-day-2',
    startedAt,
  );
  assert.equal(active.ok, false);
  assert.equal(active.error.code, 'EXECUTION_DAY_ALREADY_ACTIVE');
});

void test('Done completes only Current and promotes the next static-plan stop', () => {
  const input = activeState();
  const inputBefore = snapshot(input);
  const planBefore = snapshot(copenhagenTrip.days[0].plan);
  const now = '2026-09-08T08:35:00.000Z';
  const result = completeCurrentStop(copenhagenTrip, input, now);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.stopExecutions[copenhagenStopIds.nyhavn], {
    stopId: copenhagenStopIds.nyhavn,
    status: 'completed',
    scheduledDayId: dayId,
    completedRecordedAt: now,
    completedOnDayId: dayId,
  });
  assert.equal(
    result.state.stopExecutions[copenhagenStopIds.amalienborg].status,
    'pending',
  );
  assert.equal(result.state.currentStopId, copenhagenStopIds.amalienborg);
  assert.equal(result.state.currentStepStartedAt, now);
  assert.equal(result.state.currentInboundTravel!.duration.status, 'unknown');
  assert.deepEqual(copenhagenTrip.days[0].plan, planBefore);
  assert.deepEqual(input, inputBefore);
});

void test('Done never reselects completed stops and final Done naturally completes the day', () => {
  let state = activeState();
  for (let index = 0; index < copenhagenTrip.stops.length; index += 1) {
    const result = completeCurrentStop(
      copenhagenTrip,
      state,
      `2026-09-08T0${9 + Math.floor(index / 2)}:${index}0:00.000Z`,
    );
    assert.equal(result.ok, true);
    state = result.state;
  }

  assert.equal(state.currentStopId, undefined);
  assert.equal(state.currentStepStartedAt, undefined);
  assert.equal(state.currentInboundTravel, undefined);
  assert.deepEqual(state.completedDayIds, [dayId]);
  assert.equal(state.executionDayId, dayId);
  assert.ok(
    Object.values(state.stopExecutions).every(
      (execution) => execution.status === 'completed',
    ),
  );
});

void test('Skip marks a skippable Current without completion history and advances', () => {
  const input = activeState();
  const inputBefore = snapshot(input);
  const now = '2026-09-08T08:10:00.000Z';
  const result = skipCurrentStop(copenhagenTrip, input, now);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.stopExecutions[copenhagenStopIds.nyhavn], {
    stopId: copenhagenStopIds.nyhavn,
    status: 'skipped',
    scheduledDayId: dayId,
  });
  assert.equal(result.state.currentStopId, copenhagenStopIds.amalienborg);
  assert.deepEqual(input, inputBefore);
});

void test('canSkip, not priority, rejects Skip and leaves state unchanged', () => {
  const trip = {
    ...copenhagenTrip,
    stops: copenhagenTrip.stops.map((stop) =>
      stop.id === copenhagenStopIds.nyhavn
        ? { ...stop, priority: 'optional' as const, canSkip: false }
        : stop,
    ),
  };
  const input = activeState();
  const before = snapshot(input);
  const result = skipCurrentStop(trip, input, startedAt);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'STOP_CANNOT_BE_SKIPPED');
  assert.deepEqual(input, before);
});

void test('Save for Later keeps Current pending, unschedules it, and advances', () => {
  const input = activeState();
  const inputBefore = snapshot(input);
  const planBefore = snapshot(copenhagenTrip.days[0].plan);
  const now = '2026-09-08T08:10:00.000Z';
  const result = saveCurrentForLater(copenhagenTrip, input, now);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.stopExecutions[copenhagenStopIds.nyhavn], {
    stopId: copenhagenStopIds.nyhavn,
    status: 'pending',
    scheduledDayId: null,
  });
  assert.equal(
    originalPlannedDayId(copenhagenTrip, copenhagenStopIds.nyhavn),
    dayId,
  );
  assert.equal(result.state.currentStopId, copenhagenStopIds.amalienborg);
  assert.deepEqual(result.state.completedDayIds, []);
  assert.equal(result.state.executionDayId, dayId);
  assert.deepEqual(copenhagenTrip.days[0].plan, planBefore);
  assert.deepEqual(input, inputBefore);
});

void test('Skip and Save for Later clear final Current and naturally complete the day', () => {
  const base = activeState();
  const onlyCurrentRemains: TripExecutionState = {
    ...base,
    stopExecutions: Object.fromEntries(
      Object.entries(base.stopExecutions).map(([stopId, execution]) => [
        stopId,
        execution.stopId === copenhagenStopIds.nyhavn
          ? execution
          : { ...execution, status: 'completed' as const },
      ]),
    ),
  };

  const results = [
    skipCurrentStop(copenhagenTrip, onlyCurrentRemains, startedAt),
    saveCurrentForLater(copenhagenTrip, onlyCurrentRemains, startedAt),
  ];
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.equal(result.state.currentStopId, undefined);
    assert.equal(result.state.currentStepStartedAt, undefined);
    assert.deepEqual(result.state.completedDayIds, [dayId]);
    assert.equal(result.state.executionDayId, dayId);
    assert.equal('tripCompletedAt' in result.state, false);
  }
});

void test('core transitions preserve unrelated trip-level execution state', () => {
  const enriched: TripExecutionState = {
    ...initialState(),
    doNowQueue: [
      {
        stopId: copenhagenStopIds.christiania,
        returnScheduledDayId: dayId,
      },
    ],
    completedDayIds: ['historical-day'],
    ruleAcknowledgements: [
      {
        ruleId: 'historical-rule',
        executionDayId: dayId,
        severity: 'SCHEDULE_TIGHT',
        acknowledgedAt: initializedAt,
      },
    ],
  };
  const started = startDay(copenhagenTrip, enriched, dayId, startedAt);
  assert.equal(started.ok, true);

  const transitions = [
    completeCurrentStop(copenhagenTrip, started.state, startedAt),
    skipCurrentStop(copenhagenTrip, started.state, startedAt),
    saveCurrentForLater(copenhagenTrip, started.state, startedAt),
  ];
  for (const result of transitions) {
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.doNowQueue, enriched.doNowQueue);
    assert.deepEqual(result.state.completedDayIds, enriched.completedDayIds);
    assert.deepEqual(
      result.state.ruleAcknowledgements,
      enriched.ruleAcknowledgements,
    );
  }
});
