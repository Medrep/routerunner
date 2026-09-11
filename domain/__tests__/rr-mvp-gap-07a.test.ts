import assert from 'node:assert/strict';
import test from 'node:test';

import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  acceptSkipRecommendation,
  acknowledgeRuleRecommendation,
  cancelDoNowStop,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  deserializeExecutionState,
  doNowStop,
  endDay,
  EXECUTION_STATE_SCHEMA_VERSION,
  markAlreadyVisited,
  recordDecisionShown,
  saveAllForLaterAndEndDay,
  saveCurrentForLater,
  skipCurrentStop,
  startDay,
  switchExecutionDay,
  tripExecutionLifecycle,
} from '../index.ts';
import type {
  ExecutionEvent,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';

const ids = {
  a: createStopId('event-a'),
  b: createStopId('event-b'),
  c: createStopId('event-c'),
  d: createStopId('event-d'),
};
const day1 = 'event-day-1';
const day2 = 'event-day-2';
const ruleId = 'event-rule';
const initializedAt = '2026-09-11T08:00:00.000Z';

const trip: Trip = {
  id: 'event-log-fixture',
  title: 'Event log fixture',
  timeZone: 'UTC',
  startDate: '2026-09-11',
  endDate: '2026-09-12',
  stops: Object.entries(ids).map(([name, id]) => ({
    id,
    name: name.toUpperCase(),
    latitude: 50,
    longitude: 20,
    priority: 'normal',
    canSkip: true,
    plannedVisitMinutes: 10,
  })),
  days: [
    {
      id: day1,
      date: '2026-09-11',
      hardEndTime: '08:29',
      plan: [
        { stopId: ids.a, order: 10 },
        { stopId: ids.b, order: 20 },
      ],
    },
    {
      id: day2,
      date: '2026-09-12',
      plan: [
        { stopId: ids.c, order: 10 },
        { stopId: ids.d, order: 20 },
      ],
    },
  ],
  legs: [
    {
      id: 'event-a-b',
      fromStopId: ids.a,
      toStopId: ids.b,
      mode: 'walk',
      plannedDurationMinutes: 10,
    },
  ],
  rules: [
    {
      id: ruleId,
      type: 'buffer_below',
      dayId: day1,
      thresholdMinutes: 30,
      action: { type: 'recommend_skip', stopId: ids.b },
    },
  ],
};

function at(minute: number): string {
  return new Date(Date.parse(initializedAt) + minute * 60_000).toISOString();
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function ready(): TripExecutionState {
  return createInitialTripExecutionState(trip, initializedAt);
}

function active(): TripExecutionState {
  return accepted(startDay(trip, ready(), day1, at(1)));
}

function activeWithKnownInbound(): TripExecutionState {
  const state = active();
  return {
    ...state,
    currentInboundTravel: {
      ...state.currentInboundTravel!,
      duration: { status: 'known', minutes: 0 },
    },
  };
}

function eventTypes(state: TripExecutionState): ExecutionEvent['type'][] {
  return state.eventLog.map((event) => event.type);
}

function oldEnvelope(version: 1 | 2, state: TripExecutionState): string {
  const oldState = structuredClone(state) as Omit<
    TripExecutionState,
    'eventLog'
  > & {
    eventLog?: ExecutionEvent[];
  };
  delete oldState.eventLog;
  return JSON.stringify({
    version,
    tripId: trip.id,
    savedAt: state.lastUpdatedAt,
    state: oldState,
  });
}

void test('schema v3 migrates canonical v2 lifecycle states and v1 without fabricating history', () => {
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 3);
  const activeState = active();
  const dayComplete = accepted(
    saveAllForLaterAndEndDay(trip, activeState, at(2)),
  );
  const switched = switchExecutionDay(trip, dayComplete, day2, at(3), {
    status: 'known',
    minutes: 0,
  });
  assert.equal(switched.status, 'switched');
  const tripComplete = accepted(
    saveAllForLaterAndEndDay(trip, switched.state, at(4)),
  );

  for (const state of [ready(), activeState, dayComplete, tripComplete]) {
    const restored = deserializeExecutionState(oldEnvelope(2, state), trip);
    assert.equal(restored.status, 'restored');
    assert.deepEqual(restored.state.eventLog, []);
  }
  const v1 = deserializeExecutionState(oldEnvelope(1, activeState), trip);
  assert.equal(v1.status, 'restored');
  assert.deepEqual(v1.state.eventLog, []);

  const invalid = JSON.parse(oldEnvelope(2, activeState));
  invalid.state.currentStopId = 'unknown-stop';
  assert.equal(
    deserializeExecutionState(JSON.stringify(invalid), trip).status,
    'invalid',
  );
});

void test('Start Day emits once and a v3 reload preserves it without hydration events', () => {
  const state = active();
  assert.deepEqual(state.eventLog, [
    {
      version: 1,
      type: 'day_started',
      executionDayId: day1,
      recordedAt: at(1),
    },
  ]);
  const restored = deserializeExecutionState(
    JSON.stringify({
      version: 3,
      tripId: trip.id,
      savedAt: state.lastUpdatedAt,
      state,
    }),
    trip,
  );
  assert.equal(restored.status, 'restored');
  assert.deepEqual(restored.state.eventLog, state.eventLog);
});

void test('Done, Skip, and Save append their action before one natural completion', () => {
  const cases = [
    {
      type: 'stop_completed',
      run: completeCurrentStop,
    },
    { type: 'stop_skipped', run: skipCurrentStop },
    { type: 'stop_saved_for_later', run: saveCurrentForLater },
  ] as const;

  for (const action of cases) {
    let state = active();
    state = accepted(markAlreadyVisited(trip, state, ids.b, at(2)));
    const result = accepted(action.run(trip, state, at(3)));
    assert.deepEqual(eventTypes(result).slice(-2), [
      action.type,
      'day_completed',
    ]);
    assert.equal(
      result.eventLog.filter((event) => event.type === 'day_completed').length,
      1,
    );
  }
});

void test('Do Now, Cancel, and Already Visited preserve execution-day attribution', () => {
  let state = active();
  state = accepted(doNowStop(trip, state, ids.c, at(2)));
  const doNowEvent = state.eventLog.at(-1)!;
  assert.deepEqual(doNowEvent, {
    version: 1,
    type: 'stop_do_now',
    stopId: ids.c,
    executionDayId: day1,
    returnScheduledDayId: day2,
    recordedAt: at(2),
  });

  state = accepted(cancelDoNowStop(trip, state, ids.c, at(3)));
  assert.deepEqual(state.eventLog.at(-1), {
    version: 1,
    type: 'stop_do_now_cancelled',
    stopId: ids.c,
    executionDayId: day1,
    restoredScheduledDayId: day2,
    recordedAt: at(3),
  });

  state = accepted(markAlreadyVisited(trip, state, ids.d, at(4)));
  assert.deepEqual(state.eventLog.at(-1), {
    version: 1,
    type: 'stop_already_visited',
    stopId: ids.d,
    executionDayId: day1,
    recordedAt: at(4),
  });
  assert.equal(state.stopExecutions[ids.d].completedOnDayId, day1);
});

void test('zero-work explicit End Day emits ended then completed, while Start alone does not complete', () => {
  const zeroTrip: Trip = {
    ...trip,
    id: 'zero-event-trip',
    stops: [],
    days: [{ id: 'zero-day', date: '2026-09-11', plan: [] }],
    legs: [],
    rules: [],
  };
  const started = accepted(
    startDay(
      zeroTrip,
      createInitialTripExecutionState(zeroTrip, initializedAt),
      'zero-day',
      at(1),
    ),
  );
  assert.deepEqual(eventTypes(started), ['day_started']);
  const ended = accepted(endDay(zeroTrip, started, at(2)));
  assert.deepEqual(eventTypes(ended), [
    'day_started',
    'day_ended',
    'day_completed',
  ]);
  assert.equal(tripExecutionLifecycle(zeroTrip, ended).status, 'TRIP_COMPLETE');
});

void test('End Day save-all logs normal stops in trip order before lifecycle and no automatic cancels', () => {
  let state = active();
  state = accepted(doNowStop(trip, state, ids.c, at(2)));
  state = accepted(doNowStop(trip, state, ids.d, at(3)));
  const completed = accepted(saveAllForLaterAndEndDay(trip, state, at(4)));
  assert.deepEqual(eventTypes(completed).slice(-4), [
    'stop_saved_for_later',
    'stop_saved_for_later',
    'day_ended',
    'day_completed',
  ]);
  assert.deepEqual(
    completed.eventLog
      .slice(-4, -2)
      .map((event) => ('stopId' in event ? event.stopId : undefined)),
    [ids.a, ids.b],
  );
  assert.equal(
    completed.eventLog.some((event) => event.type === 'stop_do_now_cancelled'),
    false,
  );
});

void test('day switch orders old cleanup, completion, then one new day start', () => {
  const result = switchExecutionDay(
    trip,
    active(),
    day2,
    at(2),
    { status: 'unknown', reason: 'unavailable' },
    'save_all_for_later',
  );
  assert.equal(result.status, 'switched');
  assert.deepEqual(eventTypes(result.state).slice(-4), [
    'stop_saved_for_later',
    'stop_saved_for_later',
    'day_completed',
    'day_started',
  ]);
  assert.equal(result.state.eventLog.at(-1)!.executionDayId, day2);

  const cleanDayOne = accepted(saveAllForLaterAndEndDay(trip, active(), at(2)));
  const clean = switchExecutionDay(trip, cleanDayOne, day2, at(3), {
    status: 'known',
    minutes: 0,
  });
  assert.equal(clean.status, 'switched');
  assert.equal(clean.state.eventLog.at(-1)!.type, 'day_started');
  assert.equal(
    clean.state.eventLog.filter((event) => event.type === 'day_completed')
      .length,
    1,
  );
});

void test('same-day Do Now reopens before logging its Stop action exactly once', () => {
  const complete = accepted(saveAllForLaterAndEndDay(trip, active(), at(2)));
  const reopened = accepted(doNowStop(trip, complete, ids.a, at(3)));
  assert.deepEqual(eventTypes(reopened).slice(-2), [
    'day_reopened',
    'stop_do_now',
  ]);
  assert.equal(reopened.completedDayIds.includes(day1), false);

  const duringComplete = accepted(
    markAlreadyVisited(trip, complete, ids.c, at(3)),
  );
  assert.equal(duringComplete.completedDayIds.includes(day1), true);
  assert.equal(
    duringComplete.eventLog.filter((event) => event.type === 'day_reopened')
      .length,
    0,
  );
});

void test('decision presentation is explicit and idempotent; Keep and accept log bounded outcomes', () => {
  const base = activeWithKnownInbound();
  const shown = accepted(recordDecisionShown(trip, base, ruleId, at(2)));
  assert.equal(shown.eventLog.at(-1)!.type, 'decision_shown');
  assert.equal(
    accepted(recordDecisionShown(trip, shown, ruleId, at(2))).eventLog.length,
    shown.eventLog.length,
  );

  const kept = accepted(
    acknowledgeRuleRecommendation(trip, shown, ruleId, at(3)),
  );
  assert.equal(kept.eventLog.at(-1)!.type, 'decision_rejected');

  const acceptedDecision = accepted(
    acceptSkipRecommendation(trip, base, ruleId, at(3)),
  );
  assert.deepEqual(eventTypes(acceptedDecision).slice(-2), [
    'decision_accepted',
    'stop_skipped',
  ]);
  assert.equal(
    acceptedDecision.eventLog.filter((event) => event.type === 'stop_skipped')
      .length,
    1,
  );
  const restoredDecision = deserializeExecutionState(
    JSON.stringify({
      version: 3,
      tripId: trip.id,
      savedAt: acceptedDecision.lastUpdatedAt,
      state: acceptedDecision,
    }),
    trip,
  );
  assert.equal(restoredDecision.status, 'restored');
  assert.deepEqual(restoredDecision.state.eventLog, acceptedDecision.eventLog);

  const suppressed = { ...base, currentInboundTravel: undefined };
  assert.equal(recordDecisionShown(trip, suppressed, ruleId, at(2)).ok, false);
  assert.deepEqual(suppressed.eventLog, base.eventLog);
});

void test('rejected actions and invalid or regressing timestamps append nothing', () => {
  const state = active();
  const snapshot = structuredClone(state);
  assert.equal(doNowStop(trip, state, ids.a, at(2)).ok, false);
  assert.equal(completeCurrentStop(trip, state, 'invalid').ok, false);
  assert.equal(completeCurrentStop(trip, state, at(0)).ok, false);
  assert.deepEqual(state, snapshot);
});

void test('v3 persistence preserves exact event order and rejects malformed event records', () => {
  let state = active();
  state = accepted(doNowStop(trip, state, ids.c, at(2)));
  state = accepted(cancelDoNowStop(trip, state, ids.c, at(3)));
  state = accepted(markAlreadyVisited(trip, state, ids.d, at(4)));
  state = accepted(saveAllForLaterAndEndDay(trip, state, at(5)));
  const serialized = JSON.stringify({
    version: 3,
    tripId: trip.id,
    savedAt: state.lastUpdatedAt,
    state,
  });
  const restored = deserializeExecutionState(serialized, trip);
  assert.equal(restored.status, 'restored');
  assert.deepEqual(restored.state.eventLog, state.eventLog);

  for (const mutate of [
    (event: Record<string, unknown>) => {
      event.type = 'unknown_event';
    },
    (event: Record<string, unknown>) => {
      event.executionDayId = 'unknown-day';
    },
    (event: Record<string, unknown>) => {
      event.recordedAt = 'not-an-instant';
    },
    (event: Record<string, unknown>) => {
      event.arbitrary = true;
    },
  ]) {
    const malformed = JSON.parse(serialized);
    mutate(malformed.state.eventLog[0]);
    assert.equal(
      deserializeExecutionState(JSON.stringify(malformed), trip).status,
      'invalid',
    );
  }

  const decreasing = JSON.parse(serialized);
  decreasing.state.eventLog[1].recordedAt = initializedAt;
  assert.equal(
    deserializeExecutionState(JSON.stringify(decreasing), trip).status,
    'invalid',
  );
});

void test('representative multi-day action history round-trips exactly and ends by derivation', () => {
  let state = activeWithKnownInbound();
  state = accepted(recordDecisionShown(trip, state, ruleId, at(2)));
  state = accepted(acknowledgeRuleRecommendation(trip, state, ruleId, at(3)));
  state = accepted(doNowStop(trip, state, ids.c, at(4)));
  state = accepted(cancelDoNowStop(trip, state, ids.c, at(5)));
  state = accepted(markAlreadyVisited(trip, state, ids.d, at(6)));
  state = accepted(completeCurrentStop(trip, state, at(7)));
  state = accepted(saveCurrentForLater(trip, state, at(8)));
  const switched = switchExecutionDay(trip, state, day2, at(9), {
    status: 'known',
    minutes: 0,
  });
  assert.equal(switched.status, 'switched');
  state = accepted(skipCurrentStop(trip, switched.state, at(10)));
  assert.equal(tripExecutionLifecycle(trip, state).status, 'TRIP_COMPLETE');
  assert.deepEqual(eventTypes(state), [
    'day_started',
    'decision_shown',
    'decision_rejected',
    'stop_do_now',
    'stop_do_now_cancelled',
    'stop_already_visited',
    'stop_completed',
    'stop_saved_for_later',
    'day_completed',
    'day_started',
    'stop_skipped',
    'day_completed',
  ]);

  const restored = deserializeExecutionState(
    JSON.stringify({
      version: 3,
      tripId: trip.id,
      savedAt: state.lastUpdatedAt,
      state,
    }),
    trip,
  );
  assert.equal(restored.status, 'restored');
  assert.deepEqual(restored.state.eventLog, state.eventLog);
});

void test('Copenhagen remains one day with 16 stops and no Rome fixture is introduced', () => {
  assert.equal(copenhagenTrip.days.length, 1);
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.equal(trip.id.toLowerCase().includes('rome'), false);
});
