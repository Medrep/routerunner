import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import { krakowField06Trip, krakowStopIds } from '../../data/trips/krakow.ts';
import {
  acceptSkipRecommendation,
  acknowledgeRuleRecommendation,
  activeExecutionRecommendation,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  loadExecutionState,
  projectSchedule,
  saveExecutionState,
  shouldRefreshScheduleProjection,
  startDay,
  validateTrip,
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
    constraintAlerts: [],
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

void test('execution page presents bounded Skip or Keep It and separate constraint alerts', () => {
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(pageSource, /aria-label="Schedule recommendation"/);
  assert.match(pageSource, /onClick=\{acceptRecommendation\}/);
  assert.match(pageSource, /Skip\{' '\}\s*\{recommendationStop\.shortName/);
  assert.match(pageSource, />\s*Keep it\s*</);
  assert.match(pageSource, /Prepared rule · no automatic change/);
  assert.match(
    pageSource,
    /recommendationStop\.priority === 'must'[\s\S]*?window\.confirm\([\s\S]*?acceptSkipRecommendation\(/,
  );
  assert.match(
    pageSource,
    /Projected arrival \$\{Math\.ceil\(alert\.latenessMinutes\)\} min after window/,
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

function boundedDecisionTrip(hardEndTime = '10:59'): Trip {
  const base = fixtureTrip();
  return {
    ...base,
    stops: base.stops.slice(0, 2),
    days: [
      {
        ...base.days[0],
        hardEndTime,
        plan: base.days[0].plan.slice(0, 2),
      },
    ],
    legs: [directedLeg('a-b', ids.a, ids.b, 0)],
    rules: [
      {
        id: 'skip-b-below-30',
        type: 'buffer_below',
        dayId,
        thresholdMinutes: 30,
        action: { type: 'recommend_skip', stopId: ids.b },
      },
    ],
  };
}

function boundedDecision(
  trip: Trip,
  state: TripExecutionState = activeState(trip, 0),
) {
  const projection = projectSchedule(trip, state, startedAt);
  return {
    projection,
    recommendation: activeExecutionRecommendation(trip, state, projection),
  };
}

function prefixKnowledgeTrip({
  firstLegKnown = true,
  secondLegKnown = false,
  bConstraint,
  cConstraint,
}: {
  firstLegKnown?: boolean;
  secondLegKnown?: boolean;
  bConstraint?: Trip['stops'][number]['timeConstraint'];
  cConstraint?: Trip['stops'][number]['timeConstraint'];
}): Trip {
  const base = fixtureTrip();
  return {
    ...base,
    stops: base.stops
      .slice(0, 3)
      .map((stop) =>
        stop.id === ids.b
          ? { ...stop, timeConstraint: bConstraint }
          : stop.id === ids.c
            ? { ...stop, timeConstraint: cConstraint }
            : stop,
      ),
    days: [
      {
        ...base.days[0],
        plan: base.days[0].plan.slice(0, 3),
      },
    ],
    legs: [
      directedLeg('a-b', ids.a, ids.b, firstLegKnown ? 1 : undefined),
      directedLeg('b-c', ids.b, ids.c, secondLegKnown ? 1 : undefined),
    ],
  };
}

void test('fixed-time projected arrival alerts only after the exact boundary', () => {
  const base = fixtureTrip();
  const tripFor = (start: string): Trip => ({
    ...base,
    stops: [
      { ...base.stops[0], timeConstraint: { type: 'fixed_time', start } },
    ],
    days: [{ ...base.days[0], plan: [base.days[0].plan[0]] }],
    legs: [],
  });

  const late = calculable(tripFor('09:55'), activeState(tripFor('09:55'), 0));
  assert.deepEqual(late.constraintAlerts, [
    {
      type: 'fixed_time_late',
      stopId: ids.a,
      projectedArrivalAt: startedAt,
      latenessMinutes: 5,
    },
  ]);
  assert.deepEqual(
    calculable(tripFor('10:00'), activeState(tripFor('10:00'), 0))
      .constraintAlerts,
    [],
  );
  const early = calculable(tripFor('10:05'), activeState(tripFor('10:05'), 0));
  assert.deepEqual(early.constraintAlerts, []);
  assert.equal(early.remainingMinutes, 15);
});

void test('time-window projected arrival alerts only after the inclusive end', () => {
  const base = twoStopTrip([directedLeg('a-b', ids.a, ids.b, 5)]);
  const tripFor = (end: string): Trip => ({
    ...base,
    stops: base.stops.map((stop) =>
      stop.id === ids.b
        ? {
            ...stop,
            timeConstraint: { type: 'time_window', start: '09:00', end },
          }
        : stop,
    ),
  });

  assert.deepEqual(
    calculable(tripFor('10:14'), activeState(tripFor('10:14'), 0))
      .constraintAlerts,
    [
      {
        type: 'time_window_late',
        stopId: ids.b,
        projectedArrivalAt: '2026-09-08T10:15:00.000Z',
        latenessMinutes: 1,
      },
    ],
  );
  assert.deepEqual(
    calculable(tripFor('10:15'), activeState(tripFor('10:15'), 0))
      .constraintAlerts,
    [],
  );
});

void test('an unknown first edge does not fabricate a later Stop alert', () => {
  const base = twoStopTrip([directedLeg('a-b', ids.a, ids.b)]);
  const trip: Trip = {
    ...base,
    stops: base.stops.map((stop) =>
      stop.id === ids.b
        ? {
            ...stop,
            timeConstraint: {
              type: 'time_window',
              start: '09:00',
              end: '09:01',
            },
          }
        : stop,
    ),
  };
  const state = activeState(trip, 0);
  const before = structuredClone(state);
  const result = projectSchedule(trip, state, startedAt);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.constraintAlerts, []);
  assert.deepEqual(state, before);
});

void test('fixed-time alert survives an unrelated later unknown edge', () => {
  const trip = prefixKnowledgeTrip({
    bConstraint: { type: 'fixed_time', start: '10:10' },
  });
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'required_leg_unknown');
  assert.deepEqual(result.constraintAlerts, [
    {
      type: 'fixed_time_late',
      stopId: ids.b,
      projectedArrivalAt: '2026-09-08T10:11:00.000Z',
      latenessMinutes: 1,
    },
  ]);
  assert.equal('remainingMinutes' in result, false);
  assert.equal('estimatedFinishAt' in result, false);
  assert.equal('bufferMinutes' in result, false);
  assert.equal('health' in result, false);
  assert.equal(
    activeExecutionRecommendation(trip, activeState(trip, 0), result),
    undefined,
  );
});

void test('time-window alert survives an unrelated later unknown edge', () => {
  const trip = prefixKnowledgeTrip({
    bConstraint: { type: 'time_window', start: '09:00', end: '10:08' },
  });
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);

  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.constraintAlerts, [
    {
      type: 'time_window_late',
      stopId: ids.b,
      projectedArrivalAt: '2026-09-08T10:11:00.000Z',
      latenessMinutes: 3,
    },
  ]);
});

void test('a deterministic on-time prefix adds no alert before a later unknown edge', () => {
  const trip = prefixKnowledgeTrip({
    bConstraint: { type: 'fixed_time', start: '10:11' },
  });
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);

  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.constraintAlerts, []);
});

void test('known prefix alert does not fabricate an alert for an unknown arrival', () => {
  const trip = prefixKnowledgeTrip({
    bConstraint: { type: 'fixed_time', start: '10:10' },
    cConstraint: { type: 'fixed_time', start: '09:00' },
  });
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);

  assert.equal(result.status, 'unavailable');
  assert.deepEqual(
    result.constraintAlerts.map((alert) => alert.stopId),
    [ids.b],
  );
});

void test('fully known route preserves complete projection and alert behavior', () => {
  const trip = prefixKnowledgeTrip({
    secondLegKnown: true,
    bConstraint: { type: 'fixed_time', start: '10:10' },
    cConstraint: { type: 'fixed_time', start: '10:31' },
  });
  const result = projectSchedule(trip, activeState(trip, 0), startedAt);

  assert.equal(result.status, 'calculable');
  assert.equal(result.estimatedFinishAt, '2026-09-08T11:02:00.000Z');
  assert.deepEqual(
    result.constraintAlerts.map((alert) => [
      alert.stopId,
      alert.latenessMinutes,
    ]),
    [
      [ids.b, 1],
      [ids.c, 1],
    ],
  );
});

void test('constraint alerts remain orthogonal to ON_PLAN schedule health', () => {
  const base = fixtureTrip();
  const trip: Trip = {
    ...base,
    stops: [
      {
        ...base.stops[0],
        timeConstraint: { type: 'fixed_time', start: '09:59' },
      },
    ],
    days: [
      {
        ...base.days[0],
        hardEndTime: '12:00',
        plan: [base.days[0].plan[0]],
      },
    ],
    legs: [],
  };
  const result = calculable(trip, activeState(trip, 0));
  assert.equal(result.health, 'ON_PLAN');
  assert.equal(result.constraintAlerts.length, 1);
});

void test('buffer rule uses strict threshold and requires calculable deadline projection', () => {
  const atThirty = boundedDecisionTrip('11:00');
  assert.equal(boundedDecision(atThirty).recommendation, undefined);

  const atTwentyNine = boundedDecisionTrip('10:59');
  const active = boundedDecision(atTwentyNine);
  assert.equal(active.projection.status, 'calculable');
  assert.equal(active.recommendation?.bufferMinutes, 29);
  assert.equal(active.recommendation?.severity, 'SCHEDULE_TIGHT');
  assert.equal(active.recommendation?.targetStopId, ids.b);

  const unavailableTrip = {
    ...atTwentyNine,
    legs: [directedLeg('a-b', ids.a, ids.b)],
  };
  assert.equal(
    boundedDecision(unavailableTrip).projection.status,
    'unavailable',
  );
  assert.equal(boundedDecision(unavailableTrip).recommendation, undefined);

  const noDeadline = {
    ...atTwentyNine,
    days: [{ ...atTwentyNine.days[0], hardEndTime: undefined }],
  };
  assert.equal(boundedDecision(noDeadline).recommendation, undefined);
});

void test('recommendation target eligibility rejects every unavailable target state', () => {
  const trip = boundedDecisionTrip();
  const base = activeState(trip, 0);
  const projection = projectSchedule(trip, base, startedAt);
  assert.ok(activeExecutionRecommendation(trip, base, projection));

  const ineligibleStates: TripExecutionState[] = [
    {
      ...base,
      stopExecutions: {
        ...base.stopExecutions,
        [ids.b]: completed(base, ids.b),
      },
    },
    {
      ...base,
      stopExecutions: {
        ...base.stopExecutions,
        [ids.b]: { ...base.stopExecutions[ids.b], status: 'skipped' },
      },
    },
    {
      ...base,
      stopExecutions: {
        ...base.stopExecutions,
        [ids.b]: { ...base.stopExecutions[ids.b], scheduledDayId: null },
      },
    },
    { ...base, currentStopId: ids.b },
    {
      ...base,
      doNowQueue: [{ stopId: ids.b, returnScheduledDayId: dayId }],
    },
  ];
  for (const state of ineligibleStates) {
    assert.equal(
      activeExecutionRecommendation(trip, state, projection),
      undefined,
    );
  }

  const cannotSkip: Trip = {
    ...trip,
    stops: trip.stops.map((stop) =>
      stop.id === ids.b ? { ...stop, canSkip: false } : stop,
    ),
  };
  assert.equal(
    activeExecutionRecommendation(cannotSkip, base, projection),
    undefined,
  );
});

void test('Keep It suppresses Tight oscillation but permits one later Risk prompt', () => {
  const tightTrip = boundedDecisionTrip();
  const state = activeState(tightTrip, 0);
  const tight = boundedDecision(tightTrip, state).recommendation!;
  const keptTight = acknowledgeRuleRecommendation(
    tightTrip,
    state,
    tight.ruleId,
    '2026-09-08T10:01:00.000Z',
  );
  assert.equal(keptTight.ok, true);
  assert.equal(
    boundedDecision(tightTrip, keptTight.state).recommendation,
    undefined,
  );

  const onPlanProjection = projectSchedule(
    boundedDecisionTrip('11:01'),
    keptTight.state,
    startedAt,
  );
  assert.equal(onPlanProjection.status, 'calculable');
  assert.equal(onPlanProjection.health, 'ON_PLAN');
  assert.equal(
    activeExecutionRecommendation(tightTrip, keptTight.state, onPlanProjection),
    undefined,
  );
  assert.equal(
    boundedDecision(tightTrip, keptTight.state).recommendation,
    undefined,
  );

  const riskTrip = boundedDecisionTrip('10:29');
  const risk = boundedDecision(riskTrip, keptTight.state).recommendation;
  assert.equal(risk?.severity, 'DEADLINE_AT_RISK');
  const keptRisk = acknowledgeRuleRecommendation(
    riskTrip,
    keptTight.state,
    risk!.ruleId,
    '2026-09-08T10:02:00.000Z',
  );
  assert.equal(keptRisk.ok, true);
  assert.equal(
    boundedDecision(riskTrip, keptRisk.state).recommendation,
    undefined,
  );
  assert.equal(
    boundedDecision(tightTrip, keptRisk.state).recommendation,
    undefined,
  );
});

void test('acknowledgement scope is execution-day specific', () => {
  const trip = boundedDecisionTrip();
  const state = activeState(trip, 0);
  const otherDayAcknowledgement: TripExecutionState = {
    ...state,
    ruleAcknowledgements: [
      {
        ruleId: 'skip-b-below-30',
        executionDayId: 'another-day',
        severity: 'DEADLINE_AT_RISK',
        acknowledgedAt: initializedAt,
      },
    ],
  };
  assert.ok(boundedDecision(trip, otherDayAcknowledgement).recommendation);
});

void test('multi-day rule ownership remains static planning data', () => {
  const trip: Trip = {
    id: 'multi-day-rule-fixture',
    title: 'Multi-day rule fixture',
    timeZone: 'UTC',
    startDate: '2026-09-08',
    endDate: '2026-09-09',
    stops: fixtureTrip().stops.slice(0, 3),
    days: [
      {
        id: 'day-1',
        date: '2026-09-08',
        hardEndTime: '10:59',
        plan: [{ stopId: ids.a, order: 10 }],
      },
      {
        id: 'day-2',
        date: '2026-09-09',
        hardEndTime: '10:59',
        plan: [
          { stopId: ids.c, order: 10 },
          { stopId: ids.b, order: 20 },
        ],
      },
    ],
    legs: [
      directedLeg('a-b', ids.a, ids.b, 0),
      directedLeg('c-b', ids.c, ids.b, 0),
    ],
    rules: [
      {
        id: 'day-2-skip-b',
        dayId: 'day-2',
        type: 'buffer_below',
        thresholdMinutes: 30,
        action: { type: 'recommend_skip', stopId: ids.b },
      },
    ],
  };
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });

  const initial = createInitialTripExecutionState(trip, initializedAt);
  const day1Started = startDay(trip, initial, 'day-1', startedAt);
  assert.equal(day1Started.ok, true);
  const day1: TripExecutionState = {
    ...day1Started.state,
    currentInboundTravel: {
      ...day1Started.state.currentInboundTravel!,
      duration: { status: 'known', minutes: 0 },
    },
  };
  assert.equal(
    activeExecutionRecommendation(
      trip,
      day1,
      projectSchedule(trip, day1, startedAt),
    ),
    undefined,
  );

  const executingBEarly: TripExecutionState = {
    ...day1,
    stopExecutions: {
      ...day1.stopExecutions,
      [ids.b]: { ...day1.stopExecutions[ids.b], scheduledDayId: 'day-1' },
    },
    doNowQueue: [{ stopId: ids.b, returnScheduledDayId: 'day-2' }],
  };
  assert.equal(
    activeExecutionRecommendation(
      trip,
      executingBEarly,
      projectSchedule(trip, executingBEarly, startedAt),
    ),
    undefined,
  );
  assert.equal(trip.rules![0].dayId, 'day-2');

  const day2Started = startDay(
    trip,
    createInitialTripExecutionState(trip, initializedAt),
    'day-2',
    '2026-09-09T10:00:00.000Z',
  );
  assert.equal(day2Started.ok, true);
  const day2: TripExecutionState = {
    ...day2Started.state,
    currentInboundTravel: {
      ...day2Started.state.currentInboundTravel!,
      duration: { status: 'known', minutes: 0 },
    },
  };
  assert.equal(
    activeExecutionRecommendation(
      trip,
      day2,
      projectSchedule(trip, day2, '2026-09-09T10:00:00.000Z'),
    )?.ruleId,
    'day-2-skip-b',
  );
});

void test('recommendation Skip is canonical, explicit, and recalculated', () => {
  const trip = boundedDecisionTrip();
  const state = activeState(trip, 0);
  assert.equal(state.stopExecutions[ids.b].status, 'pending');
  assert.ok(boundedDecision(trip, state).recommendation);

  const skipped = acceptSkipRecommendation(
    trip,
    state,
    'skip-b-below-30',
    startedAt,
  );
  assert.equal(skipped.ok, true);
  assert.equal(skipped.state.stopExecutions[ids.b].status, 'skipped');
  assert.equal(skipped.state.currentStopId, ids.a);
  assert.equal(skipped.state.currentStepStartedAt, state.currentStepStartedAt);
  assert.deepEqual(
    skipped.state.currentInboundTravel,
    state.currentInboundTravel,
  );
  assert.equal(boundedDecision(trip, skipped.state).recommendation, undefined);
  const naturallyCompleted = completeCurrentStop(
    trip,
    skipped.state,
    startedAt,
  );
  assert.equal(naturallyCompleted.ok, true);
  assert.deepEqual(naturallyCompleted.state.completedDayIds, [dayId]);
  assert.equal(
    acceptSkipRecommendation(trip, skipped.state, 'skip-b-below-30', startedAt)
      .ok,
    false,
  );
});

void test('stale recommendation Skip is rejected by domain authority without mutation', () => {
  const trip = boundedDecisionTrip();
  const base = activeState(trip, 0);
  assert.ok(boundedDecision(trip, base).recommendation);
  const staleStates: TripExecutionState[] = [
    {
      ...base,
      currentStopId: ids.b,
      currentInboundTravel: {
        fromStopId: ids.a,
        toStopId: ids.b,
        duration: { status: 'known', minutes: 0 },
      },
    },
    {
      ...base,
      doNowQueue: [{ stopId: ids.b, returnScheduledDayId: dayId }],
    },
    {
      ...base,
      stopExecutions: {
        ...base.stopExecutions,
        [ids.b]: { ...base.stopExecutions[ids.b], scheduledDayId: null },
      },
    },
    {
      ...base,
      stopExecutions: {
        ...base.stopExecutions,
        [ids.b]: { ...base.stopExecutions[ids.b], status: 'skipped' },
      },
    },
  ];

  for (const state of staleStates) {
    const before = structuredClone(state);
    const result = acceptSkipRecommendation(
      trip,
      state,
      'skip-b-below-30',
      startedAt,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(state, before);
  }

  const recoveredTrip = boundedDecisionTrip('11:00');
  const recoveredState = activeState(recoveredTrip, 0);
  const recoveredBefore = structuredClone(recoveredState);
  assert.equal(
    acceptSkipRecommendation(
      recoveredTrip,
      recoveredState,
      'skip-b-below-30',
      startedAt,
    ).ok,
    false,
  );
  assert.deepEqual(recoveredState, recoveredBefore);

  const unavailableTrip: Trip = {
    ...trip,
    legs: [directedLeg('a-b', ids.a, ids.b)],
  };
  const unavailableState = activeState(unavailableTrip, 0);
  assert.equal(
    acceptSkipRecommendation(
      unavailableTrip,
      unavailableState,
      'skip-b-below-30',
      startedAt,
    ).ok,
    false,
  );

  const kept = acknowledgeRuleRecommendation(
    trip,
    base,
    'skip-b-below-30',
    startedAt,
  );
  assert.equal(kept.ok, true);
  assert.equal(
    acceptSkipRecommendation(trip, kept.state, 'skip-b-below-30', startedAt).ok,
    false,
  );
  assert.equal(
    acceptSkipRecommendation(trip, base, 'missing-rule', startedAt).ok,
    false,
  );
});

void test('Keep It rejects inactive and stale rule actions without mutation', () => {
  const trip = boundedDecisionTrip('11:00');
  const state = activeState(trip, 0);
  const before = structuredClone(state);

  assert.equal(
    acknowledgeRuleRecommendation(trip, state, 'skip-b-below-30', startedAt).ok,
    false,
  );
  assert.equal(
    acknowledgeRuleRecommendation(trip, state, 'missing-rule', startedAt).ok,
    false,
  );
  assert.deepEqual(state, before);
  assert.deepEqual(state.ruleAcknowledgements, []);
});

void test('recommendation API exposes no arbitrary future-Stop Skip transition', async () => {
  const executionApi = await import('../execution/index.ts');
  assert.equal('skipRecommendationTarget' in executionApi, false);
  assert.equal(typeof executionApi.acceptSkipRecommendation, 'function');
});

void test('must-stop recommendation remains active and uses the same bounded action', () => {
  const base = boundedDecisionTrip();
  const trip: Trip = {
    ...base,
    stops: base.stops.map((stop) =>
      stop.id === ids.b ? { ...stop, priority: 'must' } : stop,
    ),
  };
  const state = activeState(trip, 0);
  assert.equal(
    boundedDecision(trip, state).recommendation?.targetStopId,
    ids.b,
  );
  assert.equal(
    acceptSkipRecommendation(trip, state, 'skip-b-below-30', startedAt).ok,
    true,
  );
});

void test('Copenhagen rule completes the 30/29, Tight, Risk, Keep It, and Skip lifecycle', () => {
  const rulesBefore = structuredClone(copenhagenTrip.rules);
  const trip: Trip = {
    ...copenhagenTrip,
    legs: copenhagenTrip.legs!.map((leg) => ({
      ...leg,
      plannedDurationMinutes: leg.plannedDurationMinutes ?? 0,
    })),
  };
  const stateAt = (now: string): TripExecutionState => {
    const initial = createInitialTripExecutionState(trip, initializedAt);
    const started = startDay(trip, initial, trip.days[0].id, now);
    assert.equal(started.ok, true);
    return {
      ...started.state,
      currentInboundTravel: {
        ...started.state.currentInboundTravel!,
        duration: { status: 'known', minutes: 0 },
      },
    };
  };
  const ruleId = 'copenhagen-reffen-buffer-below-30';
  const atThirty = '2026-09-08T09:46:00.000Z';
  const thirtyState = stateAt(atThirty);
  const thirtyProjection = projectSchedule(trip, thirtyState, atThirty);
  assert.equal(thirtyProjection.status, 'calculable');
  assert.equal(thirtyProjection.bufferMinutes, 30);
  assert.equal(
    activeExecutionRecommendation(trip, thirtyState, thirtyProjection),
    undefined,
  );

  const atTwentyNine = '2026-09-08T09:47:00.000Z';
  const tightState = stateAt(atTwentyNine);
  const tightProjection = projectSchedule(trip, tightState, atTwentyNine);
  const tight = activeExecutionRecommendation(
    trip,
    tightState,
    tightProjection,
  );
  assert.equal(tightProjection.status, 'calculable');
  assert.equal(tightProjection.bufferMinutes, 29);
  assert.equal(tight?.ruleId, ruleId);
  assert.equal(tight?.severity, 'SCHEDULE_TIGHT');
  assert.equal(tight?.targetStopId, copenhagenStopIds.reffen);

  const keptTight = acknowledgeRuleRecommendation(
    trip,
    tightState,
    ruleId,
    atTwentyNine,
  );
  assert.equal(keptTight.ok, true);
  assert.equal(
    activeExecutionRecommendation(
      trip,
      keptTight.state,
      projectSchedule(trip, keptTight.state, atTwentyNine),
    ),
    undefined,
  );

  const riskAt = '2026-09-08T10:17:00.000Z';
  const riskState: TripExecutionState = {
    ...keptTight.state,
    currentStepStartedAt: riskAt,
  };
  const riskProjection = projectSchedule(trip, riskState, riskAt);
  const risk = activeExecutionRecommendation(trip, riskState, riskProjection);
  assert.equal(riskProjection.status, 'calculable');
  assert.equal(riskProjection.bufferMinutes, -1);
  assert.equal(risk?.severity, 'DEADLINE_AT_RISK');
  const keptRisk = acknowledgeRuleRecommendation(
    trip,
    riskState,
    ruleId,
    riskAt,
  );
  assert.equal(keptRisk.ok, true);
  assert.equal(
    activeExecutionRecommendation(
      trip,
      keptRisk.state,
      projectSchedule(trip, keptRisk.state, riskAt),
    ),
    undefined,
  );
  assert.equal(
    keptRisk.state.stopExecutions[copenhagenStopIds.reffen].status,
    'pending',
  );

  const accepted = acceptSkipRecommendation(
    trip,
    tightState,
    ruleId,
    atTwentyNine,
  );
  assert.equal(accepted.ok, true);
  assert.equal(
    accepted.state.stopExecutions[copenhagenStopIds.reffen].status,
    'skipped',
  );
  assert.equal(accepted.state.currentStopId, tightState.currentStopId);
  assert.equal(
    accepted.state.currentStepStartedAt,
    tightState.currentStepStartedAt,
  );
  assert.deepEqual(
    accepted.state.currentInboundTravel,
    tightState.currentInboundTravel,
  );
  assert.deepEqual(copenhagenTrip.rules, rulesBefore);
});
