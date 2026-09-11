import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deriveTripOverviewPresentation } from '../../components/routerunner/trip-overview-presentation.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  cancelDoNowStop,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  deriveStopActionModel,
  deriveRouteMapView,
  doNowStop,
  loadExecutionState,
  markAlreadyVisited,
  nextEligiblePendingStopId,
  pendingForLaterActionModels,
  persistExecutionTransition,
  projectSchedule,
  projectedExecutionStopIds,
  saveExecutionState,
  startDay,
  switchExecutionDay,
  tripExecutionLifecycle,
  waitingDoNowActionModels,
} from '../index.ts';
import type {
  ExecutionStorage,
  StopActionEligibility,
  StopId,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';

const ids = {
  a: createStopId('gap06-a'),
  b: createStopId('gap06-b'),
  c: createStopId('gap06-c'),
  d: createStopId('gap06-d'),
  x: createStopId('gap06-x'),
  y: createStopId('gap06-y'),
  z: createStopId('gap06-z'),
  unknown: createStopId('gap06-unknown'),
};
const dayOneId = 'gap06-day-1';
const dayTwoId = 'gap06-day-2';
const initializedAt = '2026-09-11T08:00:00.000Z';
const startedAt = '2026-09-11T09:00:00.000Z';
const changedAt = '2026-09-11T10:00:00.000Z';
const laterAt = '2026-09-11T11:00:00.000Z';

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

function stop(id: StopId, name: string) {
  return {
    id,
    name,
    visitBrief: `${name} visit brief`,
    highlights: [`${name} highlight`],
    latitude: 41.9,
    longitude: 12.5,
    priority: 'normal' as const,
    canSkip: true,
    plannedVisitMinutes: 10,
  };
}

function fixtureTrip(): Trip {
  return {
    id: 'gap06-rome-like',
    title: 'GAP-06 Rome-like fixture',
    city: 'Rome',
    timeZone: 'UTC',
    startDate: '2026-09-11',
    endDate: '2026-09-12',
    stops: [
      stop(ids.a, 'A'),
      stop(ids.b, 'B'),
      stop(ids.c, 'C'),
      stop(ids.d, 'D'),
      stop(ids.x, 'X'),
      stop(ids.y, 'Y'),
      stop(ids.z, 'Z'),
    ],
    days: [
      {
        id: dayOneId,
        date: '2026-09-11',
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
        plan: [
          { stopId: ids.x, order: 10 },
          { stopId: ids.y, order: 20 },
        ],
      },
    ],
    legs: [
      {
        id: 'a-b',
        fromStopId: ids.a,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'a-c',
        fromStopId: ids.a,
        toStopId: ids.c,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'a-x',
        fromStopId: ids.a,
        toStopId: ids.x,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'b-c',
        fromStopId: ids.b,
        toStopId: ids.c,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'c-b',
        fromStopId: ids.c,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'c-d',
        fromStopId: ids.c,
        toStopId: ids.d,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'x-b',
        fromStopId: ids.x,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
      {
        id: 'x-y',
        fromStopId: ids.x,
        toStopId: ids.y,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
    ],
  };
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function activeState(trip = fixtureTrip()): TripExecutionState {
  const state = accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      dayOneId,
      startedAt,
    ),
  );
  return {
    ...state,
    currentInboundTravel: {
      fromStopId: null,
      toStopId: ids.a,
      duration: { status: 'known', minutes: 0 },
    },
  };
}

function queued(
  stopIds: readonly StopId[],
  trip = fixtureTrip(),
): TripExecutionState {
  return stopIds.reduce(
    (state, stopId) => accepted(doNowStop(trip, state, stopId, changedAt)),
    activeState(trip),
  );
}

function allFalse(actions: StopActionEligibility): boolean {
  return Object.values(actions).every((allowed) => !allowed);
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

void test('Cancel restores future, For-Later, and same-day planning contexts exactly', () => {
  const trip = fixtureTrip();
  for (const [stopId, expectedDayId] of [
    [ids.x, dayTwoId],
    [ids.z, null],
    [ids.c, dayOneId],
  ] as const) {
    const state = queued([stopId], trip);
    const before = structuredClone(state);
    const cancelled = accepted(cancelDoNowStop(trip, state, stopId, laterAt));

    assert.deepEqual(state, before);
    assert.equal(cancelled.stopExecutions[stopId].status, 'pending');
    assert.equal(
      cancelled.stopExecutions[stopId].scheduledDayId,
      expectedDayId,
    );
    assert.equal(cancelled.doNowQueue.length, 0);
    assert.equal(cancelled.lastUpdatedAt, laterAt);
    assert.deepEqual(roundTrip(trip, cancelled), cancelled);
  }
});

void test('Cancel removes any selected waiting position, preserves FIFO, and renumbers presentation', () => {
  const trip = fixtureTrip();
  const state = queued([ids.c, ids.d, ids.x], trip);
  const cancelled = accepted(cancelDoNowStop(trip, state, ids.d, laterAt));

  assert.deepEqual(
    cancelled.doNowQueue.map((entry) => entry.stopId),
    [ids.c, ids.x],
  );
  assert.deepEqual(
    waitingDoNowActionModels(trip, cancelled).map((model) => ({
      stopId: model.stopId,
      position: model.queuePosition,
      label: model.statusLabel,
    })),
    [
      { stopId: ids.c, position: 1, label: 'Queued for now' },
      { stopId: ids.x, position: 2, label: 'Queued for now' },
    ],
  );

  for (const stopId of [ids.c, ids.x]) {
    const edgeState = queued([ids.c, ids.d, ids.x], trip);
    const edgeCancelled = accepted(
      cancelDoNowStop(trip, edgeState, stopId, laterAt),
    );
    assert.equal(
      edgeCancelled.doNowQueue.some((entry) => entry.stopId === stopId),
      false,
    );
  }
});

void test('Cancel is a planning-only mutation and canonical order/projection update', () => {
  const trip = fixtureTrip();
  const state = queued([ids.x], trip);
  const cancelled = accepted(cancelDoNowStop(trip, state, ids.x, laterAt));

  for (const key of [
    'executionDayId',
    'executionDayStartedAt',
    'currentStopId',
    'currentStepStartedAt',
    'currentInboundTravel',
    'completedDayIds',
    'ruleAcknowledgements',
  ] as const) {
    assert.deepEqual(cancelled[key], state[key]);
  }
  assert.deepEqual(projectedExecutionStopIds(trip, state), [
    ids.a,
    ids.x,
    ids.b,
    ids.c,
    ids.d,
  ]);
  assert.deepEqual(projectedExecutionStopIds(trip, cancelled), [
    ids.a,
    ids.b,
    ids.c,
    ids.d,
  ]);
  assert.equal(nextEligiblePendingStopId(trip, cancelled), ids.b);
  assert.deepEqual(projectSchedule(trip, cancelled, laterAt).projectedStopIds, [
    ids.a,
    ids.b,
    ids.c,
    ids.d,
  ]);

  const sameDay = accepted(
    cancelDoNowStop(trip, queued([ids.c], trip), ids.c, laterAt),
  );
  assert.deepEqual(projectedExecutionStopIds(trip, sameDay), [
    ids.a,
    ids.b,
    ids.c,
    ids.d,
  ]);
});

void test('Cancel rejects Current, active provenance, non-queued, terminal, mismatch, unknown, and invalid time without mutation', () => {
  const trip = fixtureTrip();
  const normal = activeState(trip);
  const waiting = queued([ids.c], trip);
  const activeOverride = accepted(
    completeCurrentStop(trip, waiting, changedAt),
  );
  const terminal: TripExecutionState = {
    ...normal,
    executionDayId: dayTwoId,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    completedDayIds: [dayTwoId],
  };
  const mismatch = { ...waiting, tripId: 'another-trip' };
  const cases = [
    [normal, ids.a, changedAt, 'STOP_IS_CURRENT'],
    [activeOverride, ids.c, changedAt, 'STOP_IS_CURRENT'],
    [normal, ids.b, changedAt, 'STOP_QUEUED'],
    [normal, ids.unknown, changedAt, 'STOP_NOT_FOUND'],
    [terminal, ids.b, changedAt, 'TRIP_COMPLETE'],
    [mismatch, ids.c, changedAt, 'TRIP_STATE_MISMATCH'],
    [waiting, ids.c, 'invalid', 'INVALID_TIMESTAMP'],
  ] as const;

  for (const [state, stopId, now, code] of cases) {
    const before = structuredClone(state);
    const result = cancelDoNowStop(trip, state, stopId, now);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.deepEqual(state, before);
  }
});

void test('Already Visited supports same-day, future-day, and For-Later without changing Current or planning history', () => {
  const trip = fixtureTrip();
  for (const [stopId, scheduledDayId] of [
    [ids.b, dayOneId],
    [ids.x, dayTwoId],
    [ids.z, null],
  ] as const) {
    const state = queued([ids.c], trip);
    const before = structuredClone(state);
    const completed = accepted(
      markAlreadyVisited(trip, state, stopId, changedAt),
    );
    const execution = completed.stopExecutions[stopId];

    assert.deepEqual(state, before);
    assert.equal(execution.status, 'completed');
    assert.equal(execution.completedRecordedAt, changedAt);
    assert.equal(execution.completedOnDayId, dayOneId);
    assert.equal(execution.scheduledDayId, scheduledDayId);
    assert.equal(completed.currentStopId, state.currentStopId);
    assert.equal(completed.currentStepStartedAt, state.currentStepStartedAt);
    assert.deepEqual(
      completed.currentInboundTravel,
      state.currentInboundTravel,
    );
    assert.deepEqual(completed.doNowQueue, state.doNowQueue);
    assert.equal(Object.hasOwn(execution, 'physicalVisitTime'), false);
    assert.deepEqual(roundTrip(trip, completed), completed);
  }
});

void test('Already Visited uses executionDayId, preserves future itinerary, and advances Next/projection', () => {
  const trip = fixtureTrip();
  const state = activeState(trip);
  const completedNext = accepted(
    markAlreadyVisited(trip, state, ids.b, changedAt),
  );
  assert.equal(nextEligiblePendingStopId(trip, completedNext), ids.c);
  assert.deepEqual(projectedExecutionStopIds(trip, completedNext), [
    ids.a,
    ids.c,
    ids.d,
  ]);
  assert.deepEqual(
    projectSchedule(trip, completedNext, changedAt).projectedStopIds,
    [ids.a, ids.c, ids.d],
  );

  const completedFuture = accepted(
    markAlreadyVisited(trip, state, ids.x, changedAt),
  );
  const preview = deriveTripOverviewPresentation(
    trip,
    completedFuture,
    dayTwoId,
  );
  const x = preview.days[1].stops.find((stop) => stop.stopId === ids.x);
  assert.equal(preview.viewedDayId, dayTwoId);
  assert.equal(completedFuture.executionDayId, dayOneId);
  assert.equal(x?.status, 'completed');
  assert.equal(x?.completedOnDayId, dayOneId);
  assert.equal(x?.completedEarly, true);
  assert.equal(
    trip.days[1].plan.some((item) => item.stopId === ids.x),
    true,
  );
});

void test('Already Visited rejects Current, active/waiting overrides, pre-start, history, terminal, mismatch, unknown, and invalid time', () => {
  const trip = fixtureTrip();
  const normal = activeState(trip);
  const waiting = queued([ids.c], trip);
  const activeOverride = accepted(
    completeCurrentStop(trip, waiting, changedAt),
  );
  const completed = accepted(
    markAlreadyVisited(trip, normal, ids.b, changedAt),
  );
  const skipped: TripExecutionState = {
    ...normal,
    stopExecutions: {
      ...normal.stopExecutions,
      [ids.b]: { ...normal.stopExecutions[ids.b], status: 'skipped' },
    },
  };
  const ready = createInitialTripExecutionState(trip, initializedAt);
  const terminal: TripExecutionState = {
    ...normal,
    executionDayId: dayTwoId,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    completedDayIds: [dayTwoId],
  };
  const cases = [
    [normal, ids.a, changedAt, 'STOP_IS_CURRENT'],
    [activeOverride, ids.c, changedAt, 'STOP_IS_CURRENT'],
    [waiting, ids.c, changedAt, 'STOP_QUEUED'],
    [ready, ids.b, changedAt, 'EXECUTION_DAY_NOT_ACTIVE'],
    [completed, ids.b, changedAt, 'STOP_NOT_PENDING'],
    [skipped, ids.b, changedAt, 'STOP_NOT_PENDING'],
    [terminal, ids.b, changedAt, 'TRIP_COMPLETE'],
    [{ ...normal, tripId: 'wrong' }, ids.b, changedAt, 'TRIP_STATE_MISMATCH'],
    [normal, ids.unknown, changedAt, 'STOP_NOT_FOUND'],
    [normal, ids.b, 'invalid', 'INVALID_TIMESTAMP'],
  ] as const;

  for (const [state, stopId, now, code] of cases) {
    const before = structuredClone(state);
    const result = markAlreadyVisited(trip, state, stopId, now);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.deepEqual(state, before);
  }
});

void test('Cancel then Already Visited is the required queued future-stop sequence', () => {
  const trip = fixtureTrip();
  const waiting = queued([ids.x], trip);
  assert.equal(markAlreadyVisited(trip, waiting, ids.x, changedAt).ok, false);

  const cancelled = accepted(cancelDoNowStop(trip, waiting, ids.x, changedAt));
  const completed = accepted(
    markAlreadyVisited(trip, cancelled, ids.x, laterAt),
  );
  assert.equal(completed.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(completed.stopExecutions[ids.x].completedOnDayId, dayOneId);
});

void test('Already Visited during DAY_COMPLETE records history without reopening it', () => {
  const trip = fixtureTrip();
  let state = activeState(trip);
  for (const stopId of [ids.b, ids.c, ids.d]) {
    state = accepted(markAlreadyVisited(trip, state, stopId, changedAt));
  }
  state = accepted(completeCurrentStop(trip, state, changedAt));
  assert.deepEqual(tripExecutionLifecycle(trip, state), {
    status: 'DAY_COMPLETE',
    dayId: dayOneId,
  });

  const completedFuture = accepted(
    markAlreadyVisited(trip, state, ids.x, laterAt),
  );
  assert.deepEqual(completedFuture.completedDayIds, [dayOneId]);
  assert.equal(completedFuture.currentStopId, undefined);
  assert.deepEqual(tripExecutionLifecycle(trip, completedFuture), {
    status: 'DAY_COMPLETE',
    dayId: dayOneId,
  });
});

void test('future work completed early remains an upcoming zero-work day until explicitly started', () => {
  const trip = fixtureTrip();
  let state = activeState(trip);
  state = accepted(markAlreadyVisited(trip, state, ids.x, changedAt));
  state = accepted(markAlreadyVisited(trip, state, ids.y, changedAt));
  state = accepted(markAlreadyVisited(trip, state, ids.b, changedAt));
  state = accepted(markAlreadyVisited(trip, state, ids.c, changedAt));
  state = accepted(markAlreadyVisited(trip, state, ids.d, changedAt));
  state = accepted(completeCurrentStop(trip, state, changedAt));
  assert.deepEqual(state.completedDayIds, [dayOneId]);

  const switched = switchExecutionDay(trip, state, dayTwoId, laterAt, {
    status: 'unknown',
    reason: 'unavailable',
  });
  assert.equal(switched.status, 'switched');
  assert.equal(switched.state.currentStopId, undefined);
  assert.deepEqual(switched.state.completedDayIds, [dayOneId]);
  assert.deepEqual(tripExecutionLifecycle(trip, switched.state), {
    status: 'ACTIVE',
    dayId: dayTwoId,
  });
});

void test('the canonical action model enforces every Stop Details matrix', () => {
  const trip = fixtureTrip();
  const active = activeState(trip);
  const current = deriveStopActionModel(trip, active, ids.a)!;
  assert.equal(current.role, 'current');
  assert.deepEqual(current.actions, {
    navigate: true,
    done: true,
    skip: true,
    saveForLater: true,
    doNow: false,
    cancelDoNow: false,
    alreadyVisited: false,
  });

  const waiting = queued([ids.c], trip);
  const waitingModel = deriveStopActionModel(trip, waiting, ids.c)!;
  assert.equal(waitingModel.role, 'waiting_do_now');
  assert.equal(waitingModel.queuePosition, 1);
  assert.deepEqual(waitingModel.actions, {
    navigate: false,
    done: false,
    skip: false,
    saveForLater: false,
    doNow: false,
    cancelDoNow: true,
    alreadyVisited: false,
  });
  assert.equal(doNowStop(trip, waiting, ids.c, laterAt).ok, false);
  assert.equal(markAlreadyVisited(trip, waiting, ids.c, laterAt).ok, false);

  const activeOverride = accepted(
    completeCurrentStop(trip, waiting, changedAt),
  );
  const activeOverrideModel = deriveStopActionModel(
    trip,
    activeOverride,
    ids.c,
  )!;
  assert.equal(activeOverrideModel.role, 'current_do_now');
  assert.deepEqual(activeOverrideModel.actions, current.actions);

  for (const stopId of [ids.b, ids.x]) {
    const pending = deriveStopActionModel(trip, active, stopId)!;
    assert.equal(pending.role, 'pending');
    assert.equal(pending.actions.doNow, true);
    assert.equal(pending.actions.alreadyVisited, true);
    assert.equal(pending.actions.navigate, false);
    assert.equal(pending.actions.done, false);
  }
  const forLater = deriveStopActionModel(trip, active, ids.z)!;
  assert.equal(forLater.role, 'for_later');
  assert.equal(forLater.actions.doNow, true);
  assert.equal(forLater.actions.alreadyVisited, true);
  assert.equal(forLater.actions.saveForLater, false);
  assert.equal(forLater.actions.navigate, false);

  const historical = accepted(
    markAlreadyVisited(trip, active, ids.b, changedAt),
  );
  assert.equal(
    allFalse(deriveStopActionModel(trip, historical, ids.b)!.actions),
    true,
  );
  const skipped: TripExecutionState = {
    ...active,
    stopExecutions: {
      ...active.stopExecutions,
      [ids.b]: { ...active.stopExecutions[ids.b], status: 'skipped' },
    },
  };
  assert.equal(
    allFalse(deriveStopActionModel(trip, skipped, ids.b)!.actions),
    true,
  );
  assert.equal(
    allFalse(
      deriveStopActionModel(
        trip,
        createInitialTripExecutionState(trip, initializedAt),
        ids.b,
      )!.actions,
    ),
    true,
  );

  const terminal: TripExecutionState = {
    ...active,
    executionDayId: dayTwoId,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    completedDayIds: [dayTwoId],
  };
  assert.equal(
    allFalse(deriveStopActionModel(trip, terminal, ids.b)!.actions),
    true,
  );
});

void test('active provenance is Current while waiting positions start at one and off-day overrides join the execution map', () => {
  const trip = fixtureTrip();
  const normalWithQueue = queued([ids.c, ids.d, ids.x], trip);
  const overrideCurrent = accepted(
    completeCurrentStop(trip, normalWithQueue, changedAt),
  );
  assert.equal(
    deriveStopActionModel(trip, overrideCurrent, ids.c)?.role,
    'current_do_now',
  );
  assert.deepEqual(
    waitingDoNowActionModels(trip, overrideCurrent).map((model) => ({
      stopId: model.stopId,
      position: model.queuePosition,
    })),
    [
      { stopId: ids.d, position: 1 },
      { stopId: ids.x, position: 2 },
    ],
  );

  const map = deriveRouteMapView(trip, normalWithQueue);
  assert.equal(
    map.stops.find((stop) => stop.stopId === ids.c)?.status,
    'queued',
  );
  assert.equal(
    map.stops.find((stop) => stop.stopId === ids.x)?.status,
    'queued',
  );
});

void test('For Later model is actionable, queues with null provenance, cancels back, and persists atomically', () => {
  const trip = fixtureTrip();
  const active = activeState(trip);
  assert.deepEqual(
    pendingForLaterActionModels(trip, active).map((model) => model.stopId),
    [ids.z],
  );

  const queuedForLater = accepted(doNowStop(trip, active, ids.z, changedAt));
  assert.deepEqual(queuedForLater.doNowQueue, [
    { stopId: ids.z, returnScheduledDayId: null },
  ]);
  assert.equal(pendingForLaterActionModels(trip, queuedForLater).length, 0);
  assert.equal(queuedForLater.currentStopId, ids.a);
  assert.deepEqual(
    queuedForLater.currentInboundTravel,
    active.currentInboundTravel,
  );

  const cancelled = accepted(
    cancelDoNowStop(trip, queuedForLater, ids.z, laterAt),
  );
  assert.equal(cancelled.stopExecutions[ids.z].scheduledDayId, null);
  assert.deepEqual(
    pendingForLaterActionModels(trip, cancelled).map((model) => model.stopId),
    [ids.z],
  );

  const storage = new FakeStorage();
  const persisted = persistExecutionTransition(
    trip,
    cancelled,
    markAlreadyVisited(trip, cancelled, ids.z, laterAt),
    storage,
  );
  assert.equal(persisted.status, 'accepted');
  assert.equal(storage.writes, 1);
  assert.equal(persisted.state.currentStopId, ids.a);
  assert.equal(pendingForLaterActionModels(trip, persisted.state).length, 0);
});

void test('Do Now with no Current creates Current with explicit unavailable inbound', () => {
  const trip = fixtureTrip();
  let state = activeState(trip);
  for (const stopId of [ids.b, ids.c, ids.d]) {
    state = accepted(markAlreadyVisited(trip, state, stopId, changedAt));
  }
  state = accepted(completeCurrentStop(trip, state, changedAt));
  const reopened = accepted(doNowStop(trip, state, ids.z, laterAt));
  assert.equal(reopened.currentStopId, ids.z);
  assert.deepEqual(reopened.currentInboundTravel, {
    fromStopId: null,
    toStopId: ids.z,
    duration: { status: 'unknown', reason: 'unavailable' },
  });
});

void test('production surface uses canonical actions for queue, preview, and For Later without a Rome fixture', () => {
  const source = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /deriveStopActionModel\(trip, execution, detail\)/);
  assert.match(source, /waitingDoNowActionModels\(trip, execution\)/);
  assert.match(source, /pendingForLaterActionModels\(trip, execution\)/);
  assert.match(source, /QUEUED FOR NOW/);
  assert.match(source, /Queued for now · FIFO/);
  assert.match(source, /> Cancel Do Now/);
  assert.match(source, /> Already visited/);
  assert.match(source, /aria-label="For later"/);
  assert.doesNotMatch(
    source,
    /isReadOnlyPreview\s*&&[\s\S]{0,120}actions\.doNow/,
  );
  assert.equal(copenhagenTrip.days.length, 1);
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.equal(
    pendingForLaterActionModels(
      copenhagenTrip,
      createInitialTripExecutionState(copenhagenTrip, initializedAt),
    ).length,
    0,
  );
});
