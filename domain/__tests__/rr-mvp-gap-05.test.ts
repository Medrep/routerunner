import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  activeExecutionRecommendation,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  doNowStop,
  endDay,
  EXECUTION_STATE_SCHEMA_VERSION,
  loadExecutionState,
  projectSchedule,
  saveExecutionState,
  skipCurrentStop,
  startDay,
  switchExecutionDay,
  tripExecutionLifecycle,
} from '../index.ts';
import type {
  ExecutionStorage,
  StopId,
  SwitchExecutionDayResult,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';
import { deriveTripOverviewPresentation } from '../../components/routerunner/trip-overview-presentation.ts';

const ids = {
  a: createStopId('gap05-a'),
  b: createStopId('gap05-b'),
  c: createStopId('gap05-c'),
  d: createStopId('gap05-d'),
  x: createStopId('gap05-x'),
  y: createStopId('gap05-y'),
  z: createStopId('gap05-z'),
};
const dayOneId = 'gap05-day-1';
const dayTwoId = 'gap05-day-2';
const dayThreeId = 'gap05-day-3';
const initializedAt = '2026-09-11T07:00:00.000Z';
const dayOneStartedAt = '2026-09-11T07:05:00.000Z';
const dayOneChangedAt = '2026-09-11T10:00:00.000Z';
const switchedAt = '2026-09-12T07:30:00.000Z';
const endedAt = '2026-09-12T18:30:00.000Z';
const knownInbound = { status: 'known' as const, minutes: 14 };
const unknownInbound = {
  status: 'unknown' as const,
  reason: 'unavailable' as const,
};

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

function stop(id: StopId, name: string) {
  return {
    id,
    name,
    latitude: 41.9,
    longitude: 12.5,
    priority: 'normal' as const,
    canSkip: true,
    plannedVisitMinutes: 10,
  };
}

function fixtureTrip(includeThirdDay = false): Trip {
  return {
    id: includeThirdDay ? 'gap05-three-day' : 'gap05-two-day',
    title: 'Rome transition fixture',
    city: 'Rome',
    timeZone: 'Europe/Rome',
    startDate: '2026-09-11',
    endDate: includeThirdDay ? '2026-09-13' : '2026-09-12',
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
        title: 'Ancient Rome',
        hardEndTime: '19:00',
        plan: [
          { stopId: ids.d, order: 40 },
          { stopId: ids.b, order: 20 },
          { stopId: ids.a, order: 10 },
          { stopId: ids.c, order: 30 },
        ],
      },
      {
        id: dayTwoId,
        date: '2026-09-12',
        title: 'Vatican and parks',
        hardEndTime: '10:00',
        plan: [
          { stopId: ids.y, order: 20 },
          { stopId: ids.x, order: 10 },
        ],
      },
      ...(includeThirdDay
        ? [{ id: dayThreeId, date: '2026-09-13', plan: [] }]
        : []),
    ],
    legs: [
      {
        id: 'gap05-x-y',
        fromStopId: ids.x,
        toStopId: ids.y,
        mode: 'walk',
        plannedDurationMinutes: 5,
      },
    ],
    rules: [
      {
        id: 'gap05-day-1-rule',
        type: 'buffer_below',
        dayId: dayOneId,
        thresholdMinutes: 1_000,
        action: { type: 'recommend_skip', stopId: ids.b },
      },
      {
        id: 'gap05-day-2-rule',
        type: 'buffer_below',
        dayId: dayTwoId,
        thresholdMinutes: 1_000,
        action: { type: 'recommend_skip', stopId: ids.y },
      },
    ],
  };
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function switched(result: SwitchExecutionDayResult): TripExecutionState {
  assert.equal(result.status, 'switched');
  return result.state;
}

function activeDayOne(trip = fixtureTrip()): TripExecutionState {
  return accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      dayOneId,
      dayOneStartedAt,
    ),
  );
}

function completeDayOne(trip = fixtureTrip()): TripExecutionState {
  let state = activeDayOne(trip);
  state = accepted(completeCurrentStop(trip, state, dayOneChangedAt));
  state = accepted(completeCurrentStop(trip, state, dayOneChangedAt));
  state = accepted(completeCurrentStop(trip, state, dayOneChangedAt));
  return accepted(skipCurrentStop(trip, state, dayOneChangedAt));
}

function roundTrip(trip: Trip, state: TripExecutionState) {
  const storage = new FakeStorage();
  assert.deepEqual(
    saveExecutionState(trip, state, state.lastUpdatedAt, storage),
    { status: 'saved', savedAt: state.lastUpdatedAt },
  );
  const loaded = loadExecutionState(trip, storage);
  assert.equal(loaded.status, 'restored');
  return loaded.state;
}

function mixedActiveDayOne(trip = fixtureTrip()): TripExecutionState {
  const active = activeDayOne(trip);
  return {
    ...active,
    currentStepStartedAt: '2026-09-11T08:00:00.000Z',
    currentInboundTravel: {
      fromStopId: null,
      toStopId: ids.a,
      duration: { status: 'known', minutes: 37 },
    },
    stopExecutions: {
      ...active.stopExecutions,
      [ids.c]: {
        ...active.stopExecutions[ids.c],
        status: 'completed',
        completedRecordedAt: dayOneChangedAt,
        completedOnDayId: dayOneId,
      },
      [ids.d]: {
        ...active.stopExecutions[ids.d],
        status: 'skipped',
      },
    },
  };
}

void test('clean DAY_COMPLETE starts the canonical next day and reloads without old timing', () => {
  const trip = fixtureTrip();
  const complete = completeDayOne(trip);
  const completeBefore = structuredClone(complete);
  const result = switchExecutionDay(
    trip,
    complete,
    dayTwoId,
    switchedAt,
    knownInbound,
  );
  const state = switched(result);

  assert.deepEqual(complete, completeBefore);
  assert.equal(state.executionDayId, dayTwoId);
  assert.equal(state.executionDayStartedAt, switchedAt);
  assert.deepEqual(state.completedDayIds, [dayOneId]);
  assert.equal(state.currentStopId, ids.x);
  assert.equal(state.currentStepStartedAt, switchedAt);
  assert.deepEqual(state.currentInboundTravel, {
    fromStopId: null,
    toStopId: ids.x,
    duration: knownInbound,
  });
  assert.equal(state.currentInboundTravel.duration.minutes === 37, false);
  assert.deepEqual(roundTrip(trip, state), state);
  assert.deepEqual(tripExecutionLifecycle(trip, state), {
    status: 'ACTIVE',
    dayId: dayTwoId,
  });
});

void test('active normal leftovers request bounded resolution without mutation', () => {
  const trip = fixtureTrip();
  const active = mixedActiveDayOne(trip);
  const before = structuredClone(active);
  const result = switchExecutionDay(
    trip,
    active,
    dayTwoId,
    switchedAt,
    knownInbound,
  );

  assert.deepEqual(result, {
    status: 'leftover_resolution_required',
    oldDayId: dayOneId,
    targetDayId: dayTwoId,
    remainingStopIds: [ids.a, ids.b],
  });
  assert.deepEqual(active, before);
  // Cancel and Review individually perform no domain transition at all.
  assert.deepEqual(active, before);
});

void test('save-all switch scopes normal leftovers and atomically initializes Day 2', () => {
  const trip = fixtureTrip();
  const state = switched(
    switchExecutionDay(
      trip,
      mixedActiveDayOne(trip),
      dayTwoId,
      switchedAt,
      knownInbound,
      'save_all_for_later',
    ),
  );

  for (const stopId of [ids.a, ids.b]) {
    assert.equal(state.stopExecutions[stopId].status, 'pending');
    assert.equal(state.stopExecutions[stopId].scheduledDayId, null);
  }
  assert.deepEqual(state.stopExecutions[ids.c], {
    stopId: ids.c,
    status: 'completed',
    scheduledDayId: dayOneId,
    completedRecordedAt: dayOneChangedAt,
    completedOnDayId: dayOneId,
  });
  assert.equal(state.stopExecutions[ids.d].status, 'skipped');
  assert.equal(state.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(state.stopExecutions[ids.y].scheduledDayId, dayTwoId);
  assert.equal(state.stopExecutions[ids.z].scheduledDayId, null);
  assert.deepEqual(state.completedDayIds, [dayOneId]);
  assert.equal(state.executionDayId, dayTwoId);
  assert.equal(state.currentStopId, ids.x);
  assert.equal(state.currentStepStartedAt, switchedAt);
  assert.deepEqual(state.currentInboundTravel?.duration, knownInbound);
});

void test('compound switch restores queued future and For-Later overrides before leftovers', () => {
  const trip = fixtureTrip();
  let active = mixedActiveDayOne(trip);
  active = accepted(doNowStop(trip, active, ids.x, dayOneChangedAt));
  active = accepted(doNowStop(trip, active, ids.z, dayOneChangedAt));
  const state = switched(
    switchExecutionDay(
      trip,
      active,
      dayTwoId,
      switchedAt,
      unknownInbound,
      'save_all_for_later',
    ),
  );

  assert.equal(state.stopExecutions[ids.a].scheduledDayId, null);
  assert.equal(state.stopExecutions[ids.b].scheduledDayId, null);
  assert.equal(state.stopExecutions[ids.x].status, 'pending');
  assert.equal(state.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(state.stopExecutions[ids.z].status, 'pending');
  assert.equal(state.stopExecutions[ids.z].scheduledDayId, null);
  assert.deepEqual(state.doNowQueue, []);
  assert.deepEqual(state.completedDayIds, [dayOneId]);
  assert.equal(state.currentStopId, ids.x);
  assert.deepEqual(state.currentInboundTravel?.duration, unknownInbound);
  assert.equal(
    Object.values(state.stopExecutions).some(
      (execution) =>
        execution.status === 'pending' && execution.scheduledDayId === dayOneId,
    ),
    false,
  );
  assert.deepEqual(roundTrip(trip, state), state);
});

void test('unfinished Current Do Now restores its prior planning context before switching', () => {
  const trip = fixtureTrip();
  const complete = completeDayOne(trip);

  const futureOverride = accepted(
    doNowStop(trip, complete, ids.x, dayOneChangedAt),
  );
  const futureState = switched(
    switchExecutionDay(
      trip,
      futureOverride,
      dayTwoId,
      switchedAt,
      knownInbound,
    ),
  );
  assert.equal(futureState.stopExecutions[ids.x].status, 'pending');
  assert.equal(futureState.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(futureState.currentStopId, ids.x);
  assert.deepEqual(futureState.doNowQueue, []);

  const forLaterOverride = accepted(
    doNowStop(trip, complete, ids.z, dayOneChangedAt),
  );
  const forLaterState = switched(
    switchExecutionDay(
      trip,
      forLaterOverride,
      dayTwoId,
      switchedAt,
      knownInbound,
    ),
  );
  assert.equal(forLaterState.stopExecutions[ids.z].status, 'pending');
  assert.equal(forLaterState.stopExecutions[ids.z].scheduledDayId, null);
  assert.equal(forLaterState.currentStopId, ids.x);
  assert.deepEqual(forLaterState.doNowQueue, []);
});

void test('early-completed, skipped, and For-Later future stops are excluded by plan order', () => {
  const trip = fixtureTrip();
  const complete = completeDayOne(trip);
  const history: TripExecutionState = {
    ...complete,
    stopExecutions: {
      ...complete.stopExecutions,
      [ids.x]: {
        ...complete.stopExecutions[ids.x],
        status: 'completed',
        completedRecordedAt: dayOneChangedAt,
        completedOnDayId: dayOneId,
      },
      [ids.y]: {
        ...complete.stopExecutions[ids.y],
        status: 'skipped',
      },
    },
  };
  const noEligible = switched(
    switchExecutionDay(trip, history, dayTwoId, switchedAt, knownInbound),
  );
  assert.equal(noEligible.currentStopId, undefined);

  const savedY: TripExecutionState = {
    ...complete,
    stopExecutions: {
      ...complete.stopExecutions,
      [ids.x]: history.stopExecutions[ids.x],
      [ids.y]: { ...complete.stopExecutions[ids.y], scheduledDayId: null },
    },
  };
  assert.equal(
    switched(
      switchExecutionDay(trip, savedY, dayTwoId, switchedAt, knownInbound),
    ).currentStopId,
    undefined,
  );
});

void test('zero-work final day remains ACTIVE through reload until explicit End Day', () => {
  const trip = fixtureTrip();
  const complete = completeDayOne(trip);
  const allEarly: TripExecutionState = {
    ...complete,
    stopExecutions: {
      ...complete.stopExecutions,
      [ids.x]: {
        ...complete.stopExecutions[ids.x],
        status: 'completed',
        completedRecordedAt: dayOneChangedAt,
        completedOnDayId: dayOneId,
      },
      [ids.y]: {
        ...complete.stopExecutions[ids.y],
        status: 'completed',
        completedRecordedAt: dayOneChangedAt,
        completedOnDayId: dayOneId,
      },
    },
  };
  const switchedZero = switched(
    switchExecutionDay(trip, allEarly, dayTwoId, switchedAt, unknownInbound),
  );

  assert.equal(switchedZero.executionDayId, dayTwoId);
  assert.equal(switchedZero.executionDayStartedAt, switchedAt);
  assert.equal(switchedZero.currentStopId, undefined);
  assert.equal(switchedZero.currentStepStartedAt, undefined);
  assert.equal(switchedZero.currentInboundTravel, undefined);
  assert.deepEqual(switchedZero.completedDayIds, [dayOneId]);
  assert.deepEqual(tripExecutionLifecycle(trip, switchedZero), {
    status: 'ACTIVE',
    dayId: dayTwoId,
  });
  assert.equal(
    projectSchedule(trip, switchedZero, switchedAt).status,
    'inactive',
  );

  const loaded = roundTrip(trip, switchedZero);
  assert.deepEqual(tripExecutionLifecycle(trip, loaded), {
    status: 'ACTIVE',
    dayId: dayTwoId,
  });
  const terminal = accepted(endDay(trip, loaded, endedAt));
  assert.deepEqual(terminal.completedDayIds, [dayOneId, dayTwoId]);
  assert.equal(tripExecutionLifecycle(trip, terminal).status, 'TRIP_COMPLETE');

  const allForLater: TripExecutionState = {
    ...complete,
    stopExecutions: {
      ...complete.stopExecutions,
      [ids.x]: { ...complete.stopExecutions[ids.x], scheduledDayId: null },
      [ids.y]: { ...complete.stopExecutions[ids.y], scheduledDayId: null },
    },
  };
  const savedZero = switched(
    switchExecutionDay(trip, allForLater, dayTwoId, switchedAt, knownInbound),
  );
  assert.equal(savedZero.currentStopId, undefined);
  assert.deepEqual(savedZero.completedDayIds, [dayOneId]);
  assert.equal(tripExecutionLifecycle(trip, savedZero).status, 'ACTIVE');
});

void test('unknown inbound is explicit and makes the new active projection unavailable', () => {
  const trip = fixtureTrip();
  const state = switched(
    switchExecutionDay(
      trip,
      completeDayOne(trip),
      dayTwoId,
      switchedAt,
      unknownInbound,
    ),
  );

  assert.deepEqual(state.currentInboundTravel?.duration, unknownInbound);
  assert.equal(projectSchedule(trip, state, switchedAt).status, 'unavailable');
});

void test('schedule and rule authority move to Day 2 while viewed day stays presentation-only', () => {
  const trip = fixtureTrip();
  const state = switched(
    switchExecutionDay(trip, completeDayOne(trip), dayTwoId, switchedAt, {
      status: 'known',
      minutes: 0,
    }),
  );
  const projection = projectSchedule(trip, state, switchedAt);
  const recommendation = activeExecutionRecommendation(trip, state, projection);
  assert.deepEqual(projection.projectedStopIds, [ids.x, ids.y]);
  assert.equal(recommendation?.ruleId, 'gap05-day-2-rule');
  assert.notEqual(recommendation?.ruleId, 'gap05-day-1-rule');

  const before = structuredClone(state);
  const historicalView = deriveTripOverviewPresentation(trip, state, dayOneId);
  assert.equal(historicalView.viewedDayId, dayOneId);
  assert.equal(historicalView.executionContext?.dayId, dayTwoId);
  assert.equal(historicalView.days[0].lifecycleStatus, 'completed');
  assert.equal(historicalView.days[1].lifecycleStatus, 'active');
  assert.deepEqual(state, before);
});

void test('same, missing, non-next, completed-target, incoherent, and terminal switches reject', () => {
  const trip = fixtureTrip(true);
  const active = activeDayOne(trip);
  const activeBefore = structuredClone(active);
  const cases = [
    [
      switchExecutionDay(trip, active, dayOneId, switchedAt, knownInbound),
      'EXECUTION_DAY_ALREADY_ACTIVE',
    ],
    [
      switchExecutionDay(trip, active, 'missing-day', switchedAt, knownInbound),
      'DAY_NOT_FOUND',
    ],
    [
      switchExecutionDay(trip, active, dayThreeId, switchedAt, knownInbound),
      'NEXT_EXECUTION_DAY_REQUIRED',
    ],
    [
      switchExecutionDay(
        trip,
        { ...active, completedDayIds: [dayTwoId] },
        dayTwoId,
        switchedAt,
        knownInbound,
      ),
      'DAY_ALREADY_COMPLETED',
    ],
    [
      switchExecutionDay(
        trip,
        { ...active, currentStepStartedAt: undefined },
        dayTwoId,
        switchedAt,
        knownInbound,
      ),
      'EXECUTION_STATE_INCOHERENT',
    ],
  ] as const;

  for (const [result, code] of cases) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, code);
  }
  assert.deepEqual(active, activeBefore);

  const twoDayTrip = fixtureTrip();
  let terminal = switched(
    switchExecutionDay(
      twoDayTrip,
      completeDayOne(twoDayTrip),
      dayTwoId,
      switchedAt,
      knownInbound,
    ),
  );
  terminal = accepted(completeCurrentStop(twoDayTrip, terminal, endedAt));
  terminal = accepted(completeCurrentStop(twoDayTrip, terminal, endedAt));
  assert.equal(
    tripExecutionLifecycle(twoDayTrip, terminal).status,
    'TRIP_COMPLETE',
  );
  const terminalResult = switchExecutionDay(
    twoDayTrip,
    terminal,
    dayOneId,
    endedAt,
    knownInbound,
  );
  assert.equal(terminalResult.status, 'rejected');
  assert.equal(terminalResult.error.code, 'TRIP_COMPLETE');
});

void test('DAY_COMPLETE reload retains Day 1 and does not switch automatically', () => {
  const trip = fixtureTrip();
  const loaded = roundTrip(trip, completeDayOne(trip));
  assert.equal(loaded.executionDayId, dayOneId);
  assert.deepEqual(loaded.completedDayIds, [dayOneId]);
  assert.equal(tripExecutionLifecycle(trip, loaded).status, 'DAY_COMPLETE');
});

void test('switch rejects noncanonical runtime inputs without mutation', () => {
  const trip = fixtureTrip();
  const complete = completeDayOne(trip);
  const completeBefore = structuredClone(complete);
  const invalidResolution = 'force' as unknown as 'save_all_for_later';
  const cases = [
    {
      result: switchExecutionDay(
        trip,
        complete,
        dayTwoId,
        'not-a-date',
        knownInbound,
      ),
      code: 'INVALID_SWITCH_TIMESTAMP',
    },
    {
      result: switchExecutionDay(trip, complete, dayTwoId, '', knownInbound),
      code: 'INVALID_SWITCH_TIMESTAMP',
    },
    {
      result: switchExecutionDay(trip, complete, dayTwoId, switchedAt, {
        status: 'known',
        minutes: -1,
      }),
      code: 'INVALID_INBOUND_DURATION',
    },
    {
      result: switchExecutionDay(trip, complete, dayTwoId, switchedAt, {
        status: 'known',
        minutes: Number.NaN,
      }),
      code: 'INVALID_INBOUND_DURATION',
    },
    {
      result: switchExecutionDay(trip, complete, dayTwoId, switchedAt, {
        status: 'known',
        minutes: Number.POSITIVE_INFINITY,
      }),
      code: 'INVALID_INBOUND_DURATION',
    },
    {
      result: switchExecutionDay(trip, complete, dayTwoId, switchedAt, {
        status: 'known',
        minutes: Number.NEGATIVE_INFINITY,
      }),
      code: 'INVALID_INBOUND_DURATION',
    },
    {
      result: switchExecutionDay(trip, complete, dayTwoId, switchedAt, {
        status: 'unknown',
        reason: 'invented',
      } as unknown as typeof unknownInbound),
      code: 'INVALID_INBOUND_DURATION',
    },
    {
      result: switchExecutionDay(
        trip,
        complete,
        dayTwoId,
        switchedAt,
        knownInbound,
        invalidResolution,
      ),
      code: 'INVALID_SWITCH_RESOLUTION',
    },
  ] as const;

  for (const { result, code } of cases) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, code);
    assert.notEqual(result.status, 'switched');
    assert.deepEqual(complete, completeBefore);
  }

  const active = mixedActiveDayOne(trip);
  const activeBefore = structuredClone(active);
  const invalidLeftoverResolution = switchExecutionDay(
    trip,
    active,
    dayTwoId,
    switchedAt,
    knownInbound,
    invalidResolution,
  );
  assert.equal(invalidLeftoverResolution.status, 'rejected');
  assert.equal(
    invalidLeftoverResolution.error.code,
    'INVALID_SWITCH_RESOLUTION',
  );
  assert.deepEqual(active, activeBefore);
});

void test('switch accepts canonical unknown and zero inbound runtime values', () => {
  const trip = fixtureTrip();
  const complete = completeDayOne(trip);
  const unknown = switched(
    switchExecutionDay(trip, complete, dayTwoId, switchedAt, unknownInbound),
  );
  assert.deepEqual(unknown.currentInboundTravel?.duration, unknownInbound);

  const zero = switched(
    switchExecutionDay(trip, complete, dayTwoId, switchedAt, {
      status: 'known',
      minutes: 0,
    }),
  );
  assert.deepEqual(zero.currentInboundTravel?.duration, {
    status: 'known',
    minutes: 0,
  });
});

void test('schema stays v2 and production wiring keeps preview and execution actions distinct', () => {
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 2);
  const source = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  const selectionBody = source.match(
    /function viewPlannedDay\(dayId: string\) \{([\s\S]*?)\n  \}/,
  )?.[1];

  assert.ok(selectionBody);
  assert.match(selectionBody, /setViewedDayId\(dayId\)/);
  assert.doesNotMatch(selectionBody, /setExecution|switchExecutionDay|persist/);
  assert.match(source, /function requestExecutionDaySwitch/);
  assert.match(source, /switchExecutionDay\(/);
  assert.match(source, /View tomorrow/);
  assert.match(source, /Start \{nextPlannedOverviewDay\.label\}/);
  assert.match(source, /leftover_resolution_required/);
  assert.match(source, /Save all for later/);
  assert.match(source, /Review individually/);
  assert.doesNotMatch(source, /Cancel Do Now|Already Visited/);
});
