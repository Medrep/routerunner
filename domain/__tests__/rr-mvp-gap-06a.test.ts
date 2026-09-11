import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeDoNowOverride,
  activeExecutionRecommendation,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  deserializeExecutionState,
  doNowStop,
  executionStorageKey,
  isActiveDoNowOverride,
  isWaitingDoNow,
  loadExecutionState,
  nextEligiblePendingStopId,
  projectSchedule,
  projectedExecutionStopIds,
  saveCurrentForLater,
  saveExecutionState,
  skipCurrentStop,
  startDay,
  waitingDoNowQueue,
} from '../index.ts';
import type {
  ExecutionStorage,
  StopId,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';

const ids = {
  a: createStopId('gap06a-a'),
  b: createStopId('gap06a-b'),
  c: createStopId('gap06a-c'),
  d: createStopId('gap06a-d'),
  x: createStopId('gap06a-x'),
  y: createStopId('gap06a-y'),
};
const dayOneId = 'gap06a-day-1';
const dayTwoId = 'gap06a-day-2';
const initializedAt = '2026-09-11T09:00:00.000Z';
const startedAt = '2026-09-11T10:00:00.000Z';
const changedAt = '2026-09-11T10:00:00.000Z';

class FakeStorage implements ExecutionStorage {
  readonly values = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function stop(id: StopId, name: string, plannedVisitMinutes: number) {
  return {
    id,
    name,
    latitude: 41.9,
    longitude: 12.5,
    priority: 'normal' as const,
    canSkip: true,
    plannedVisitMinutes,
  };
}

function fixtureTrip(): Trip {
  return {
    id: 'gap06a-fixture',
    title: 'Do Now contract fixture',
    city: 'Rome',
    timeZone: 'UTC',
    startDate: '2026-09-11',
    endDate: '2026-09-12',
    stops: [
      stop(ids.a, 'A', 10),
      stop(ids.b, 'B', 20),
      stop(ids.c, 'C', 30),
      stop(ids.d, 'D', 40),
      stop(ids.x, 'X', 15),
      stop(ids.y, 'Y', 15),
    ],
    days: [
      {
        id: dayOneId,
        date: '2026-09-11',
        hardEndTime: '12:15',
        plan: [
          { stopId: ids.a, order: 10 },
          { stopId: ids.b, order: 20 },
          { stopId: ids.c, order: 30 },
          { stopId: ids.d, order: 40 },
        ],
      },
      {
        id: dayTwoId,
        date: '2026-09-12',
        plan: [{ stopId: ids.x, order: 10 }],
      },
    ],
    legs: [
      {
        id: 'gap06a-c-b',
        fromStopId: ids.c,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 13,
      },
      {
        id: 'gap06a-b-d',
        fromStopId: ids.b,
        toStopId: ids.d,
        mode: 'walk',
        plannedDurationMinutes: 17,
      },
      {
        id: 'gap06a-c-d',
        fromStopId: ids.c,
        toStopId: ids.d,
        mode: 'walk',
        plannedDurationMinutes: 9,
      },
      {
        id: 'gap06a-d-b',
        fromStopId: ids.d,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 11,
      },
      {
        id: 'gap06a-d-x',
        fromStopId: ids.d,
        toStopId: ids.x,
        mode: 'walk',
        plannedDurationMinutes: 7,
      },
      {
        id: 'gap06a-x-b',
        fromStopId: ids.x,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 8,
      },
    ],
    rules: [
      {
        id: 'gap06a-buffer-rule',
        type: 'buffer_below',
        dayId: dayOneId,
        thresholdMinutes: 30,
        action: { type: 'recommend_skip', stopId: ids.b },
      },
    ],
  };
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function activeState(trip = fixtureTrip()): TripExecutionState {
  return accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      dayOneId,
      startedAt,
    ),
  );
}

function withKnownInbound(state: TripExecutionState): TripExecutionState {
  return {
    ...state,
    currentInboundTravel: {
      ...state.currentInboundTravel!,
      duration: { status: 'known', minutes: 0 },
    },
  };
}

function promotedSameDayOverride(
  waitingStopIds: StopId[] = [],
  trip = fixtureTrip(),
): TripExecutionState {
  let state = activeState(trip);
  state = accepted(doNowStop(trip, state, ids.c, changedAt));
  for (const stopId of waitingStopIds) {
    state = accepted(doNowStop(trip, state, stopId, changedAt));
  }
  return withKnownInbound(
    accepted(completeCurrentStop(trip, state, changedAt)),
  );
}

function roundTrip(trip: Trip, state: TripExecutionState): TripExecutionState {
  const storage = new FakeStorage();
  assert.deepEqual(
    saveExecutionState(trip, state, state.lastUpdatedAt, storage),
    { status: 'saved', savedAt: state.lastUpdatedAt },
  );
  const loaded = loadExecutionState(trip, storage);
  assert.equal(loaded.status, 'restored');
  assert.deepEqual(loaded.state, state);
  return loaded.state;
}

function assertRejectedAtPersistenceBoundaries(
  trip: Trip,
  state: TripExecutionState,
): void {
  const storage = new FakeStorage();
  assert.equal(
    saveExecutionState(trip, state, state.lastUpdatedAt, storage).status,
    'invalid',
  );
  assert.equal(storage.writes, 0);

  const serialized = JSON.stringify({
    version: 2,
    tripId: trip.id,
    savedAt: state.lastUpdatedAt,
    state,
  });
  assert.equal(deserializeExecutionState(serialized, trip).status, 'invalid');
  storage.values.set(executionStorageKey(trip.id), serialized);
  assert.equal(loadExecutionState(trip, storage).status, 'invalid');
}

void test('canonical helpers distinguish active provenance from waiting FIFO', () => {
  const trip = fixtureTrip();
  let normalCurrent = activeState(trip);
  normalCurrent = accepted(doNowStop(trip, normalCurrent, ids.c, changedAt));
  normalCurrent = accepted(doNowStop(trip, normalCurrent, ids.d, changedAt));

  assert.equal(activeDoNowOverride(normalCurrent), undefined);
  assert.deepEqual(
    waitingDoNowQueue(normalCurrent).map((entry) => entry.stopId),
    [ids.c, ids.d],
  );
  assert.equal(isActiveDoNowOverride(normalCurrent, ids.a), false);
  assert.equal(isWaitingDoNow(normalCurrent, ids.c), true);

  const overrideCurrent = withKnownInbound(
    accepted(completeCurrentStop(trip, normalCurrent, changedAt)),
  );
  assert.equal(activeDoNowOverride(overrideCurrent)?.stopId, ids.c);
  assert.equal(isActiveDoNowOverride(overrideCurrent, ids.c), true);
  assert.equal(isWaitingDoNow(overrideCurrent, ids.c), false);
  assert.deepEqual(
    waitingDoNowQueue(overrideCurrent).map((entry) => entry.stopId),
    [ids.d],
  );
});

void test('promotion retains queue-head provenance and temporary scheduling', () => {
  const state = promotedSameDayOverride();

  assert.equal(state.currentStopId, ids.c);
  assert.deepEqual(state.doNowQueue, [
    { stopId: ids.c, returnScheduledDayId: dayOneId },
  ]);
  assert.equal(state.stopExecutions[ids.c].scheduledDayId, dayOneId);
  assert.equal(state.stopExecutions[ids.b].status, 'pending');
});

void test('Done, Skip, and Save consume active provenance before resuming B', () => {
  const trip = fixtureTrip();
  const transitions = [
    {
      run: completeCurrentStop,
      expectedStatus: 'completed',
      expectedDayId: dayOneId,
    },
    {
      run: skipCurrentStop,
      expectedStatus: 'skipped',
      expectedDayId: dayOneId,
    },
    {
      run: saveCurrentForLater,
      expectedStatus: 'pending',
      expectedDayId: null,
    },
  ] as const;

  for (const transition of transitions) {
    const state = accepted(
      transition.run(trip, promotedSameDayOverride([], trip), changedAt),
    );
    assert.equal(state.currentStopId, ids.b);
    assert.deepEqual(state.doNowQueue, []);
    assert.equal(state.stopExecutions[ids.c].status, transition.expectedStatus);
    assert.equal(
      state.stopExecutions[ids.c].scheduledDayId,
      transition.expectedDayId,
    );
  }
});

void test('active same-day override resumes earlier pending B across transition, Next, and projection', () => {
  const trip = fixtureTrip();
  const state = promotedSameDayOverride([], trip);
  const projection = projectSchedule(trip, state, changedAt);

  assert.equal(nextEligiblePendingStopId(trip, state), ids.b);
  assert.deepEqual(projectedExecutionStopIds(trip, state), [
    ids.c,
    ids.b,
    ids.d,
  ]);
  assert.deepEqual(projection.projectedStopIds, [ids.c, ids.b, ids.d]);
  assert.equal(projection.status, 'calculable');
  assert.equal(projection.remainingMinutes, 120);
  assert.equal(projection.bufferMinutes, 15);
  assert.equal(projection.health, 'SCHEDULE_TIGHT');
  assert.equal(
    activeExecutionRecommendation(trip, state, projection)?.targetStopId,
    ids.b,
  );

  const advanced = accepted(completeCurrentStop(trip, state, changedAt));
  assert.equal(advanced.currentStopId, ids.b);
});

void test('waiting override precedes normal resumption without duplication', () => {
  const trip = fixtureTrip();
  const state = promotedSameDayOverride([ids.d], trip);

  assert.equal(nextEligiblePendingStopId(trip, state), ids.d);
  assert.deepEqual(projectedExecutionStopIds(trip, state), [
    ids.c,
    ids.d,
    ids.b,
  ]);
  assert.deepEqual(projectSchedule(trip, state, changedAt).projectedStopIds, [
    ids.c,
    ids.d,
    ids.b,
  ]);
  assert.equal(
    projectedExecutionStopIds(trip, state).filter((stopId) => stopId === ids.c)
      .length,
    1,
  );
  assert.equal(
    projectedExecutionStopIds(trip, state).filter((stopId) => stopId === ids.d)
      .length,
    1,
  );

  const dCurrent = accepted(completeCurrentStop(trip, state, changedAt));
  assert.equal(dCurrent.currentStopId, ids.d);
  assert.deepEqual(dCurrent.doNowQueue, [
    { stopId: ids.d, returnScheduledDayId: dayOneId },
  ]);
  const bCurrent = accepted(completeCurrentStop(trip, dCurrent, changedAt));
  assert.equal(bCurrent.currentStopId, ids.b);
});

void test('multiple waiting overrides preserve FIFO before normal route', () => {
  const trip = fixtureTrip();
  const state = promotedSameDayOverride([ids.d, ids.x], trip);

  assert.deepEqual(
    waitingDoNowQueue(state).map((entry) => entry.stopId),
    [ids.d, ids.x],
  );
  assert.deepEqual(projectedExecutionStopIds(trip, state), [
    ids.c,
    ids.d,
    ids.x,
    ids.b,
  ]);
  const dCurrent = accepted(completeCurrentStop(trip, state, changedAt));
  const xCurrent = accepted(completeCurrentStop(trip, dCurrent, changedAt));
  const bCurrent = accepted(completeCurrentStop(trip, xCurrent, changedAt));
  assert.equal(dCurrent.currentStopId, ids.d);
  assert.equal(xCurrent.currentStopId, ids.x);
  assert.equal(bCurrent.currentStopId, ids.b);
});

void test('unknown resumed C-to-B leg makes the corrected full projection unavailable', () => {
  const base = fixtureTrip();
  const trip: Trip = {
    ...base,
    legs: base.legs?.filter((leg) => leg.id !== 'gap06a-c-b'),
  };
  const state = promotedSameDayOverride([], trip);
  const projection = projectSchedule(trip, state, changedAt);

  assert.equal(projection.status, 'unavailable');
  assert.equal(projection.reason, 'required_leg_unknown');
  assert.deepEqual(projection.projectedStopIds, [ids.c, ids.b, ids.d]);
  assert.equal(
    activeExecutionRecommendation(trip, state, projection),
    undefined,
  );
});

void test('persistence accepts active head, normal Current plus waiting, and preserves FIFO', () => {
  const trip = fixtureTrip();
  const active = promotedSameDayOverride([ids.d, ids.x], trip);
  const restoredActive = roundTrip(trip, active);
  assert.equal(activeDoNowOverride(restoredActive)?.stopId, ids.c);
  assert.deepEqual(
    waitingDoNowQueue(restoredActive).map((entry) => entry.stopId),
    [ids.d, ids.x],
  );

  let normal = activeState(trip);
  normal = accepted(doNowStop(trip, normal, ids.c, changedAt));
  normal = accepted(doNowStop(trip, normal, ids.d, changedAt));
  const restoredNormal = roundTrip(trip, normal);
  assert.equal(activeDoNowOverride(restoredNormal), undefined);
  assert.deepEqual(
    waitingDoNowQueue(restoredNormal).map((entry) => entry.stopId),
    [ids.c, ids.d],
  );
});

void test('persistence rejects Current appearing after queue head on save, hydrate, and load', () => {
  const trip = fixtureTrip();
  const canonical = promotedSameDayOverride([ids.d], trip);
  const invalid: TripExecutionState = {
    ...canonical,
    doNowQueue: [canonical.doNowQueue[1], canonical.doNowQueue[0]],
  };

  assertRejectedAtPersistenceBoundaries(trip, invalid);
});

void test('For-Later and future-day active overrides retain exact return provenance', () => {
  const trip = fixtureTrip();

  let forLater = activeState(trip);
  forLater = accepted(doNowStop(trip, forLater, ids.y, changedAt));
  forLater = accepted(completeCurrentStop(trip, forLater, changedAt));
  assert.equal(forLater.currentStopId, ids.y);
  assert.equal(forLater.stopExecutions[ids.y].scheduledDayId, dayOneId);
  assert.deepEqual(forLater.doNowQueue, [
    { stopId: ids.y, returnScheduledDayId: null },
  ]);
  roundTrip(trip, forLater);

  let futureDay = activeState(trip);
  futureDay = accepted(doNowStop(trip, futureDay, ids.x, changedAt));
  futureDay = accepted(completeCurrentStop(trip, futureDay, changedAt));
  assert.equal(futureDay.currentStopId, ids.x);
  assert.equal(futureDay.stopExecutions[ids.x].scheduledDayId, dayOneId);
  assert.deepEqual(futureDay.doNowQueue, [
    { stopId: ids.x, returnScheduledDayId: dayTwoId },
  ]);
  roundTrip(trip, futureDay);
});
