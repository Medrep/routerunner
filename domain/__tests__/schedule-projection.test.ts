import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import { krakowField06Trip, krakowStopIds } from '../../data/trips/krakow.ts';
import {
  createInitialTripExecutionState,
  createStopId,
  loadExecutionState,
  projectSchedule,
  saveExecutionState,
  shouldRefreshScheduleProjection,
  startDay,
} from '../index.ts';
import type {
  ExecutionStorage,
  StopId,
  Trip,
  TripExecutionState,
} from '../index.ts';

const ids = {
  a: createStopId('schedule-a'),
  b: createStopId('schedule-b'),
  c: createStopId('schedule-c'),
  d: createStopId('schedule-d'),
};
const dayId = 'schedule-day';
const initializedAt = '2026-09-08T09:00:00.000Z';
const startedAt = '2026-09-08T10:00:00.000Z';

function fixtureTrip(): Trip {
  return {
    id: 'schedule-fixture',
    title: 'Schedule fixture',
    timeZone: 'UTC',
    startDate: '2026-09-08',
    endDate: '2026-09-08',
    stops: [
      {
        id: ids.a,
        name: 'A',
        latitude: 0,
        longitude: 0,
        priority: 'must',
        canSkip: true,
        plannedVisitMinutes: 10,
      },
      {
        id: ids.b,
        name: 'B',
        latitude: 1,
        longitude: 1,
        priority: 'normal',
        canSkip: true,
        plannedVisitMinutes: 20,
      },
      {
        id: ids.c,
        name: 'C',
        latitude: 2,
        longitude: 2,
        priority: 'normal',
        canSkip: true,
        plannedVisitMinutes: 30,
      },
      {
        id: ids.d,
        name: 'D',
        latitude: 3,
        longitude: 3,
        priority: 'optional',
        canSkip: true,
        plannedVisitMinutes: 40,
      },
    ],
    days: [
      {
        id: dayId,
        date: '2026-09-08',
        plannedStartTime: '06:00',
        hardEndTime: '13:00',
        plan: [
          { stopId: ids.a, order: 10, plannedStartTime: '07:00' },
          { stopId: ids.b, order: 20, plannedStartTime: '08:00' },
          { stopId: ids.c, order: 30, plannedStartTime: '09:00' },
          { stopId: ids.d, order: 40, plannedStartTime: '10:00' },
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
        id: 'b-c',
        fromStopId: ids.b,
        toStopId: ids.c,
        mode: 'walk',
        plannedDurationMinutes: 7,
      },
      {
        id: 'c-d',
        fromStopId: ids.c,
        toStopId: ids.d,
        mode: 'walk',
        plannedDurationMinutes: 9,
      },
      {
        id: 'a-c',
        fromStopId: ids.a,
        toStopId: ids.c,
        mode: 'walk',
        plannedDurationMinutes: 11,
      },
      {
        id: 'c-b',
        fromStopId: ids.c,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 13,
      },
      {
        id: 'b-d',
        fromStopId: ids.b,
        toStopId: ids.d,
        mode: 'walk',
        plannedDurationMinutes: 17,
      },
    ],
  };
}

function twoStopTrip(legs: NonNullable<Trip['legs']>): Trip {
  const base = fixtureTrip();
  return {
    ...base,
    stops: base.stops.slice(0, 2),
    days: [
      {
        ...base.days[0],
        plan: base.days[0].plan.slice(0, 2),
      },
    ],
    legs,
  };
}

function directedLeg(
  id: string,
  fromStopId: StopId,
  toStopId: StopId,
  plannedDurationMinutes?: number,
): NonNullable<Trip['legs']>[number] {
  return {
    id,
    fromStopId,
    toStopId,
    mode: 'walk',
    ...(plannedDurationMinutes === undefined ? {} : { plannedDurationMinutes }),
  };
}

function activeState(
  trip = fixtureTrip(),
  inboundMinutes = 5,
): TripExecutionState {
  const initial = createInitialTripExecutionState(trip, initializedAt);
  const started = startDay(trip, initial, trip.days[0].id, startedAt);
  assert.equal(started.ok, true);
  return {
    ...started.state,
    currentInboundTravel: {
      ...started.state.currentInboundTravel!,
      duration: { status: 'known', minutes: inboundMinutes },
    },
  };
}

function completed(state: TripExecutionState, stopId: StopId) {
  return {
    ...state.stopExecutions[stopId],
    status: 'completed' as const,
    completedRecordedAt: startedAt,
    completedOnDayId: dayId,
  };
}

function calculable(trip: Trip, state: TripExecutionState, now = startedAt) {
  const result = projectSchedule(trip, state, now);
  assert.equal(result.status, 'calculable');
  return result;
}

void test('subtracts Current elapsed time exactly once from its complete budget', () => {
  const trip = fixtureTrip();
  const state = activeState(trip);
  const atStart = calculable(trip, state);
  const afterFiveMinutes = calculable(trip, state, '2026-09-08T10:05:00.000Z');

  assert.equal(atStart.remainingMinutes, 126);
  assert.equal(afterFiveMinutes.remainingMinutes, 121);
  assert.equal(afterFiveMinutes.estimatedFinishAt, '2026-09-08T12:06:00.000Z');
});

void test('includes persisted inbound travel in the Current step', () => {
  const trip = {
    ...fixtureTrip(),
    days: [{ ...fixtureTrip().days[0], plan: [fixtureTrip().days[0].plan[0]] }],
  };
  assert.equal(
    calculable(trip, activeState(trip), startedAt).remainingMinutes,
    15,
  );
});

for (const type of ['fixed_time', 'time_window'] as const) {
  void test(`includes deterministic Current ${type} early-arrival waiting`, () => {
    const base = fixtureTrip();
    const trip: Trip = {
      ...base,
      stops: [
        {
          ...base.stops[0],
          timeConstraint:
            type === 'fixed_time'
              ? { type, start: '11:00' }
              : { type, start: '11:00', end: '12:00' },
        },
      ],
      days: [{ ...base.days[0], plan: [base.days[0].plan[0]] }],
      legs: [],
    };

    const result = calculable(trip, activeState(trip), startedAt);
    assert.equal(result.remainingMinutes, 70);
    assert.equal(result.estimatedFinishAt, '2026-09-08T11:10:00.000Z');
  });
}

void test('zero matching future Legs makes projection unavailable', () => {
  const trip = twoStopTrip([]);
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'required_leg_unknown');
  assert.equal('health' in result, false);
});

void test('exactly one matching known future Leg is calculable', () => {
  const trip = twoStopTrip([directedLeg('a-b', ids.a, ids.b, 5)]);
  const result = calculable(trip, activeState(trip, 0));
  assert.equal(result.remainingMinutes, 35);
  assert.equal(result.estimatedFinishAt, '2026-09-08T10:35:00.000Z');
});

void test('one matching future Leg with missing duration is unavailable', () => {
  const trip = twoStopTrip([directedLeg('a-b', ids.a, ids.b)]);
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'required_leg_unknown');
});

void test('two matching known future Legs are ambiguous and unavailable', () => {
  const trip = twoStopTrip([
    directedLeg('a-b-1', ids.a, ids.b, 5),
    directedLeg('a-b-2', ids.a, ids.b, 5),
  ]);
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'required_leg_ambiguous');
  assert.equal('health' in result, false);
});

void test('two matching future Legs with different durations remain unavailable', () => {
  const trip = twoStopTrip([
    directedLeg('a-b-fast', ids.a, ids.b, 5),
    directedLeg('a-b-slow', ids.a, ids.b, 50),
  ]);
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'required_leg_ambiguous');
  assert.equal('health' in result, false);
});

void test('reversing ambiguous future Legs produces the same unavailable result', () => {
  const legs = [
    directedLeg('a-b-fast', ids.a, ids.b, 5),
    directedLeg('a-b-slow', ids.a, ids.b, 50),
  ];
  const forwardTrip = twoStopTrip(legs);
  const reversedTrip = twoStopTrip([...legs].reverse());
  assert.deepEqual(
    projectSchedule(forwardTrip, activeState(forwardTrip, 0), startedAt),
    projectSchedule(reversedTrip, activeState(reversedTrip, 0), startedAt),
  );
});

void test('one matching future Leg resolves normally alongside unrelated Legs', () => {
  const trip = twoStopTrip([
    directedLeg('b-a', ids.b, ids.a, 50),
    directedLeg('a-b', ids.a, ids.b, 5),
  ]);
  assert.equal(calculable(trip, activeState(trip, 0)).remainingMinutes, 35);
});

void test('future Leg matching respects directed endpoints', () => {
  const reverseOnlyTrip = twoStopTrip([directedLeg('b-a', ids.b, ids.a, 5)]);
  const result = projectSchedule(
    reverseOnlyTrip,
    activeState(reverseOnlyTrip, 0),
    startedAt,
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'required_leg_unknown');
});

void test('Current persisted inbound remains authoritative despite duplicate endpoint Legs', () => {
  const base = fixtureTrip();
  const trip: Trip = {
    ...base,
    stops: [base.stops[0], base.stops[3]],
    days: [{ ...base.days[0], plan: [base.days[0].plan[0]] }],
    legs: [
      directedLeg('d-a-fast', ids.d, ids.a, 1),
      directedLeg('d-a-slow', ids.d, ids.a, 50),
    ],
  };
  const baseState = activeState(trip, 7);
  const state: TripExecutionState = {
    ...baseState,
    currentInboundTravel: {
      ...baseState.currentInboundTravel!,
      fromStopId: ids.d,
    },
  };
  const result = calculable(trip, state);
  assert.equal(result.remainingMinutes, 17);
});

for (const type of ['fixed_time', 'time_window'] as const) {
  void test(`includes deterministic future ${type} early-arrival waiting`, () => {
    const base = fixtureTrip();
    const trip: Trip = {
      ...base,
      stops: base.stops.map((stop) =>
        stop.id === ids.b
          ? {
              ...stop,
              timeConstraint:
                type === 'fixed_time'
                  ? { type, start: '11:00' }
                  : { type, start: '11:00', end: '12:00' },
            }
          : stop,
      ),
    };

    const result = calculable(trip, activeState(trip), startedAt);
    assert.equal(result.remainingMinutes, 166);
    assert.equal(result.estimatedFinishAt, '2026-09-08T12:46:00.000Z');
  });
}

for (const type of ['fixed_time', 'time_window'] as const) {
  void test(`late arrival adds no ${type} waiting`, () => {
    const base = fixtureTrip();
    const constrainedStop = {
      ...base.stops[0],
      timeConstraint:
        type === 'fixed_time'
          ? { type, start: '09:00' }
          : { type, start: '09:00', end: '09:30' },
    };
    const trip: Trip = {
      ...base,
      stops: [constrainedStop],
      days: [{ ...base.days[0], plan: [base.days[0].plan[0]] }],
      legs: [],
    };
    assert.equal(calculable(trip, activeState(trip)).remainingMinutes, 15);
  });
}

void test('excludes completed Stops', () => {
  const trip = fixtureTrip();
  const base = activeState(trip);
  const state: TripExecutionState = {
    ...base,
    stopExecutions: {
      ...base.stopExecutions,
      [ids.b]: completed(base, ids.b),
    },
  };
  assert.deepEqual(calculable(trip, state).projectedStopIds, [
    ids.a,
    ids.c,
    ids.d,
  ]);
});

void test('excludes skipped Stops', () => {
  const trip = fixtureTrip();
  const base = activeState(trip);
  const state: TripExecutionState = {
    ...base,
    stopExecutions: {
      ...base.stopExecutions,
      [ids.b]: { ...base.stopExecutions[ids.b], status: 'skipped' },
    },
  };
  assert.deepEqual(calculable(trip, state).projectedStopIds, [
    ids.a,
    ids.c,
    ids.d,
  ]);
});

void test('excludes For Later Stops', () => {
  const trip = fixtureTrip();
  const base = activeState(trip);
  const state: TripExecutionState = {
    ...base,
    stopExecutions: {
      ...base.stopExecutions,
      [ids.b]: { ...base.stopExecutions[ids.b], scheduledDayId: null },
    },
  };
  assert.deepEqual(calculable(trip, state).projectedStopIds, [
    ids.a,
    ids.c,
    ids.d,
  ]);
});

void test('excludes an early-completed future Stop', () => {
  const trip = fixtureTrip();
  const base = activeState(trip);
  const state: TripExecutionState = {
    ...base,
    stopExecutions: {
      ...base.stopExecutions,
      [ids.d]: completed(base, ids.d),
    },
  };

  const result = calculable(trip, state);
  assert.deepEqual(result.projectedStopIds, [ids.a, ids.b, ids.c]);
});

void test('Do Now participates FIFO and queued Stops are not duplicated in the normal route', () => {
  const trip = fixtureTrip();
  const base = activeState(trip);
  const state: TripExecutionState = {
    ...base,
    doNowQueue: [
      { stopId: ids.c, returnScheduledDayId: dayId },
      { stopId: ids.b, returnScheduledDayId: dayId },
      { stopId: ids.c, returnScheduledDayId: dayId },
    ],
  };

  const result = calculable(trip, state);
  assert.deepEqual(result.projectedStopIds, [ids.a, ids.c, ids.b, ids.d]);
  assert.equal(result.remainingMinutes, 146);
});

void test('known complete path returns remaining duration and estimated finish', () => {
  const trip = fixtureTrip();
  const result = calculable(
    trip,
    activeState(trip),
    '2026-09-08T10:05:00.000Z',
  );
  assert.equal(result.remainingMinutes, 121);
  assert.equal(result.estimatedFinishAt, '2026-09-08T12:06:00.000Z');
});

void test('unknown Current inbound suppresses finish, buffer, and health', () => {
  const trip = fixtureTrip();
  const state = activeState(trip);
  const result = projectSchedule(
    trip,
    {
      ...state,
      currentInboundTravel: {
        ...state.currentInboundTravel!,
        duration: { status: 'unknown', reason: 'unresolved' },
      },
    },
    startedAt,
  );

  assert.deepEqual(result, {
    status: 'unavailable',
    reason: 'current_inbound_unknown',
    projectedStopIds: [ids.a, ids.b, ids.c, ids.d],
  });
  assert.equal('estimatedFinishAt' in result, false);
  assert.equal('bufferMinutes' in result, false);
});

void test('unknown future required Leg suppresses precise projection until resolved', () => {
  const knownTrip = fixtureTrip();
  const unknownTrip: Trip = {
    ...knownTrip,
    legs: knownTrip.legs!.map((leg) =>
      leg.id === 'b-c' ? { ...leg, plannedDurationMinutes: undefined } : leg,
    ),
  };
  const state = activeState(unknownTrip);
  const unavailable = projectSchedule(unknownTrip, state, startedAt);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.reason, 'required_leg_unknown');
  assert.equal('estimatedFinishAt' in unavailable, false);
  assert.equal('bufferMinutes' in unavailable, false);

  const resumed = calculable(knownTrip, state);
  assert.equal(resumed.estimatedFinishAt, '2026-09-08T12:06:00.000Z');
  assert.equal(resumed.bufferMinutes, 54);
});

void test('no-deadline day returns duration and finish without health or buffer', () => {
  const base = fixtureTrip();
  const trip: Trip = {
    ...base,
    days: [{ ...base.days[0], hardEndTime: undefined }],
  };
  const result = calculable(
    trip,
    activeState(trip),
    '2026-09-08T10:05:00.000Z',
  );

  assert.equal(result.remainingMinutes, 121);
  assert.equal(result.estimatedFinishAt, '2026-09-08T12:06:00.000Z');
  assert.equal(result.health, undefined);
  assert.equal(result.bufferMinutes, undefined);
});

for (const [buffer, expected] of [
  [30, 'ON_PLAN'],
  [31, 'ON_PLAN'],
  [29, 'SCHEDULE_TIGHT'],
  [0, 'SCHEDULE_TIGHT'],
  [-1, 'DEADLINE_AT_RISK'],
] as const) {
  void test(`classifies a ${buffer}-minute hard-deadline buffer as ${expected}`, () => {
    const base = fixtureTrip();
    const deadlineMinutes = 60 + buffer;
    const hours = 10 + Math.floor(deadlineMinutes / 60);
    const minutes = deadlineMinutes % 60;
    const hardEndTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const trip: Trip = {
      ...base,
      stops: [{ ...base.stops[0], plannedVisitMinutes: 60 }],
      days: [
        {
          ...base.days[0],
          hardEndTime,
          plan: [base.days[0].plan[0]],
        },
      ],
      legs: [],
    };
    const result = calculable(trip, activeState(trip, 0));

    assert.equal(result.bufferMinutes, buffer);
    assert.equal(result.health, expected);
  });
}

void test('elapsed time cannot make remaining Current duration negative', () => {
  const base = fixtureTrip();
  const trip: Trip = {
    ...base,
    stops: [base.stops[0]],
    days: [{ ...base.days[0], plan: [base.days[0].plan[0]] }],
    legs: [],
  };
  const result = calculable(
    trip,
    activeState(trip),
    '2026-09-08T11:00:00.000Z',
  );
  assert.equal(result.remainingMinutes, 0);
  assert.equal(result.estimatedFinishAt, '2026-09-08T11:00:00.000Z');
});

void test('plannedStartTime does not affect projection', () => {
  const trip = fixtureTrip();
  const changed: Trip = {
    ...trip,
    days: [
      {
        ...trip.days[0],
        plannedStartTime: '23:45',
        plan: trip.days[0].plan.map((item) => ({
          ...item,
          plannedStartTime: '00:01',
        })),
      },
    ],
  };
  const state = activeState(trip);
  assert.deepEqual(
    projectSchedule(changed, state, '2026-09-08T10:05:00.000Z'),
    projectSchedule(trip, state, '2026-09-08T10:05:00.000Z'),
  );
});

void test('projection does not mutate Trip or execution state', () => {
  const trip = fixtureTrip();
  const state = activeState(trip);
  const tripBefore = structuredClone(trip);
  const stateBefore = structuredClone(state);
  projectSchedule(trip, state, startedAt);
  assert.deepEqual(trip, tripBefore);
  assert.deepEqual(state, stateBefore);
});

void test('projection clock eligibility follows active Current execution only', () => {
  const trip = fixtureTrip();
  const preStart = createInitialTripExecutionState(trip, initializedAt);
  const active = activeState(trip);
  const exhausted: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
  };

  assert.equal(shouldRefreshScheduleProjection(preStart), false);
  assert.equal(shouldRefreshScheduleProjection(active), true);
  assert.equal(shouldRefreshScheduleProjection(exhausted), false);
});

void test('execution page conditionally owns one projection interval with cleanup', () => {
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(pageSource.match(/window\.setInterval\(/g)?.length, 1);
  assert.match(
    pageSource,
    /if \(!refreshProjectionClock\) return;[\s\S]*?const timer = window\.setInterval\([\s\S]*?setProjectionNow\(new Date\(\)\.toISOString\(\)\)[\s\S]*?return \(\) => window\.clearInterval\(timer\);[\s\S]*?\}, \[refreshProjectionClock\]\);/,
  );
});

void test('before Start and exhausted active days return neutral inactive results', () => {
  const trip = fixtureTrip();
  const initial = createInitialTripExecutionState(trip, initializedAt);
  assert.deepEqual(projectSchedule(trip, initial, startedAt), {
    status: 'inactive',
    reason: 'not_started',
    projectedStopIds: [],
  });

  const active = activeState(trip);
  const exhausted: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
  };
  assert.deepEqual(projectSchedule(trip, exhausted, startedAt), {
    status: 'inactive',
    reason: 'no_remaining_work',
    projectedStopIds: [],
  });
});

void test('persisted timing inputs restore unchanged and reproduce projection', () => {
  const trip = fixtureTrip();
  const state = activeState(trip);
  const values = new Map<string, string>();
  const storage: ExecutionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  assert.equal(
    saveExecutionState(trip, state, state.lastUpdatedAt, storage).status,
    'saved',
  );
  const loaded = loadExecutionState(trip, storage);
  assert.equal(loaded.status, 'restored');
  assert.equal(loaded.state.currentStepStartedAt, state.currentStepStartedAt);
  assert.deepEqual(
    loaded.state.currentInboundTravel,
    state.currentInboundTravel,
  );
  assert.deepEqual(
    projectSchedule(trip, loaded.state, startedAt),
    projectSchedule(trip, state, startedAt),
  );
});

void test('Copenhagen keeps its deadline and rule while known versus unknown paths project canonically', () => {
  assert.equal(copenhagenTrip.days[0].hardEndTime, '18:30');
  const rulesBefore = structuredClone(copenhagenTrip.rules);
  const knownTrip: Trip = {
    ...copenhagenTrip,
    legs: copenhagenTrip.legs!.map((leg) => ({
      ...leg,
      plannedDurationMinutes: leg.plannedDurationMinutes ?? 10,
    })),
  };
  const state = activeStateForTrip(knownTrip, 0);
  const known = projectSchedule(knownTrip, state, '2026-09-08T08:30:00.000Z');
  assert.equal(known.status, 'calculable');
  assert.equal(known.remainingMinutes, 484);
  assert.equal(known.estimatedFinishAt, '2026-09-08T16:34:00.000Z');
  assert.equal(known.bufferMinutes, -4);
  assert.equal(known.health, 'DEADLINE_AT_RISK');
  assert.equal('recommendation' in known, false);

  const unknown = projectSchedule(
    copenhagenTrip,
    state,
    '2026-09-08T08:30:00.000Z',
  );
  assert.equal(unknown.status, 'unavailable');
  assert.deepEqual(copenhagenTrip.rules, rulesBefore);
  assert.equal(
    copenhagenTrip.rules![0].action.stopId,
    copenhagenStopIds.reffen,
  );
});

void test('Kraków focused known path projects without deadline health or planned-time influence', () => {
  assert.equal(krakowField06Trip.days[0].hardEndTime, undefined);
  const knownTrip: Trip = {
    ...krakowField06Trip,
    legs: krakowField06Trip.legs!.map((leg) => ({
      ...leg,
      plannedDurationMinutes: 10,
    })),
  };
  const state = activeStateForTrip(knownTrip, 5);
  assert.equal(state.currentStopId, krakowStopIds.placWolnica);
  const result = projectSchedule(knownTrip, state, '2026-09-12T08:30:00.000Z');
  assert.equal(result.status, 'calculable');
  assert.equal(result.remainingMinutes, 200);
  assert.equal(result.estimatedFinishAt, '2026-09-12T11:50:00.000Z');
  assert.equal(result.health, undefined);
  assert.equal(result.bufferMinutes, undefined);
});

function activeStateForTrip(trip: Trip, inboundMinutes: number) {
  const initial = createInitialTripExecutionState(trip, initializedAt);
  const started = startDay(
    trip,
    initial,
    trip.days[0].id,
    `${trip.days[0].date}T08:30:00.000Z`,
  );
  assert.equal(started.ok, true);
  return {
    ...started.state,
    currentInboundTravel: {
      ...started.state.currentInboundTravel!,
      duration: { status: 'known' as const, minutes: inboundMinutes },
    },
  };
}
