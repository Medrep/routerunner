import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  copenhagenAirport,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  acknowledgeRuleRecommendation,
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  doNowStop,
  endDay,
  isTripComplete,
  loadExecutionState,
  postDayGoogleMapsNavigationUrl,
  projectSchedule,
  reopenCompletedDay,
  saveAllForLaterAndEndDay,
  saveCurrentForLater,
  saveExecutionState,
  skipCurrentStop,
  startDay,
  tripExecutionLifecycle,
} from '../index.ts';
import type {
  ExecutionStorage,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';

const ids = {
  a: createStopId('gap03-a'),
  b: createStopId('gap03-b'),
  x: createStopId('gap03-x'),
  y: createStopId('gap03-y'),
};
const dayOneId = 'gap03-day-1';
const dayTwoId = 'gap03-day-2';
const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:05:00.000Z';
const changedAt = '2026-09-08T09:00:00.000Z';
const endedAt = '2026-09-08T18:30:00.000Z';

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

function stop(id: (typeof ids)[keyof typeof ids], name: string) {
  return {
    id,
    name,
    latitude: 0,
    longitude: 0,
    priority: 'normal' as const,
    canSkip: true,
    plannedVisitMinutes: 10,
  };
}

function fixtureTrip(dayOneStopIds = [ids.a, ids.b]): Trip {
  return {
    id: 'gap03-fixture',
    title: 'Lifecycle fixture',
    timeZone: 'UTC',
    startDate: '2026-09-08',
    endDate: '2026-09-09',
    stops: [
      stop(ids.a, 'A'),
      stop(ids.b, 'B'),
      stop(ids.x, 'X'),
      stop(ids.y, 'Y'),
    ],
    days: [
      {
        id: dayOneId,
        date: '2026-09-08',
        plan: dayOneStopIds.map((stopId, index) => ({
          stopId,
          order: (index + 1) * 10,
        })),
      },
      {
        id: dayTwoId,
        date: '2026-09-09',
        plan: [{ stopId: ids.x, order: 10 }],
      },
    ],
  };
}

function singleDayTrip(): Trip {
  const trip = fixtureTrip([ids.a]);
  return {
    ...trip,
    endDate: trip.startDate,
    days: [trip.days[0]],
  };
}

function zeroWorkTrip(): Trip {
  return {
    id: 'gap03-zero',
    title: 'Zero work',
    timeZone: 'UTC',
    startDate: '2026-09-08',
    endDate: '2026-09-08',
    stops: [stop(ids.y, 'Y')],
    days: [{ id: dayOneId, date: '2026-09-08', plan: [] }],
  };
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function activeState(trip: Trip = fixtureTrip()) {
  return accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      dayOneId,
      startedAt,
    ),
  );
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

void test('Done on the final active item naturally produces DAY_COMPLETE', () => {
  const trip = fixtureTrip([ids.a]);
  const completed = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );

  assert.equal(completed.executionDayId, dayOneId);
  assert.equal(completed.currentStopId, undefined);
  assert.deepEqual(completed.completedDayIds, [dayOneId]);
  assert.deepEqual(tripExecutionLifecycle(trip, completed), {
    status: 'DAY_COMPLETE',
    dayId: dayOneId,
  });
  assert.equal(isTripComplete(trip, completed), false);
});

void test('Skip and Save for Later naturally complete the last active item', () => {
  const trip = singleDayTrip();
  const transitions = [skipCurrentStop, saveCurrentForLater] as const;

  for (const transition of transitions) {
    const completed = accepted(transition(trip, activeState(trip), changedAt));
    assert.deepEqual(completed.completedDayIds, [dayOneId]);
    assert.equal(completed.executionDayId, dayOneId);
    assert.equal(completed.currentStopId, undefined);
    assert.equal(
      tripExecutionLifecycle(trip, completed).status,
      'TRIP_COMPLETE',
    );
  }
});

void test('natural completion happens only after the last eligible transition', () => {
  const trip = fixtureTrip();
  const afterA = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );
  assert.deepEqual(afterA.completedDayIds, []);
  assert.equal(afterA.currentStopId, ids.b);

  const afterB = accepted(completeCurrentStop(trip, afterA, changedAt));
  assert.deepEqual(afterB.completedDayIds, [dayOneId]);
  assert.equal(afterB.currentStopId, undefined);
});

void test('a newly started zero-work day remains open until explicit End Day', () => {
  const trip = zeroWorkTrip();
  const open = activeState(trip);

  assert.equal(open.executionDayId, dayOneId);
  assert.equal(open.currentStopId, undefined);
  assert.deepEqual(open.completedDayIds, []);
  assert.deepEqual(tripExecutionLifecycle(trip, open), {
    status: 'ACTIVE',
    dayId: dayOneId,
  });
  assert.equal(projectSchedule(trip, open, changedAt).status, 'inactive');

  const terminal = accepted(endDay(trip, open, endedAt));
  assert.deepEqual(terminal.completedDayIds, [dayOneId]);
  assert.equal(terminal.executionDayId, dayOneId);
  assert.equal(tripExecutionLifecycle(trip, terminal).status, 'TRIP_COMPLETE');
  assert.equal(terminal.stopExecutions[ids.y].status, 'pending');
  assert.equal(terminal.stopExecutions[ids.y].scheduledDayId, null);
});

void test('null Current alone never marks an arbitrary active day complete', () => {
  const trip = fixtureTrip();
  const active = activeState(trip);
  const arbitraryNull: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
  };

  assert.deepEqual(arbitraryNull.completedDayIds, []);
  assert.equal(tripExecutionLifecycle(trip, arbitraryNull).status, 'ACTIVE');
});

void test('same-day Do Now reopens DAY_COMPLETE and exhaustion completes it again', () => {
  const trip = fixtureTrip([ids.a]);
  const saved = accepted(
    saveCurrentForLater(trip, activeState(trip), changedAt),
  );
  assert.equal(tripExecutionLifecycle(trip, saved).status, 'DAY_COMPLETE');
  assert.equal(saved.stopExecutions[ids.a].scheduledDayId, null);

  const reopened = accepted(doNowStop(trip, saved, ids.a, changedAt));
  assert.deepEqual(reopened.completedDayIds, []);
  assert.equal(reopened.executionDayId, dayOneId);
  assert.equal(reopened.currentStopId, ids.a);
  assert.deepEqual(reopened.doNowQueue, [
    { stopId: ids.a, returnScheduledDayId: null },
  ]);

  const recompleted = accepted(completeCurrentStop(trip, reopened, changedAt));
  assert.deepEqual(recompleted.completedDayIds, [dayOneId]);
  assert.equal(recompleted.executionDayId, dayOneId);
  assert.deepEqual(recompleted.doNowQueue, []);
  assert.equal(recompleted.stopExecutions[ids.a].status, 'completed');
});

void test('narrow reopen removes only the retained execution-day marker', () => {
  const trip = fixtureTrip([ids.a]);
  const complete = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );
  const before = structuredClone(complete.stopExecutions);
  const reopened = accepted(
    reopenCompletedDay(trip, complete, dayOneId, changedAt),
  );

  assert.deepEqual(reopened.completedDayIds, []);
  assert.equal(reopened.executionDayId, dayOneId);
  assert.equal(reopened.currentStopId, undefined);
  assert.deepEqual(reopened.stopExecutions, before);
});

void test('End Day with normal work enters bounded resolution without mutation', () => {
  const trip = fixtureTrip();
  const active = activeState(trip);
  const before = structuredClone(active);
  const result = endDay(trip, active, endedAt);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'END_DAY_REQUIRES_RESOLUTION');
  assert.deepEqual(active, before);
});

void test('Save all for later resolves Current and future work then ends Day 1', () => {
  const trip = fixtureTrip();
  const completed = accepted(
    saveAllForLaterAndEndDay(trip, activeState(trip), endedAt),
  );

  for (const stopId of [ids.a, ids.b]) {
    assert.equal(completed.stopExecutions[stopId].status, 'pending');
    assert.equal(completed.stopExecutions[stopId].scheduledDayId, null);
  }
  assert.equal(completed.currentStopId, undefined);
  assert.equal(completed.currentStepStartedAt, undefined);
  assert.equal(completed.currentInboundTravel, undefined);
  assert.equal(completed.executionDayId, dayOneId);
  assert.deepEqual(completed.completedDayIds, [dayOneId]);
});

void test('End Day restores queued Day-2 and For-Later Do Now contexts', () => {
  const trip = fixtureTrip();
  let active = activeState(trip);
  active = accepted(doNowStop(trip, active, ids.x, changedAt));
  active = accepted(doNowStop(trip, active, ids.y, changedAt));
  assert.equal(active.stopExecutions[ids.x].scheduledDayId, dayOneId);
  assert.equal(active.stopExecutions[ids.y].scheduledDayId, dayOneId);

  const completed = accepted(saveAllForLaterAndEndDay(trip, active, endedAt));
  assert.deepEqual(completed.doNowQueue, []);
  assert.equal(completed.stopExecutions[ids.x].status, 'pending');
  assert.equal(completed.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(completed.stopExecutions[ids.y].status, 'pending');
  assert.equal(completed.stopExecutions[ids.y].scheduledDayId, null);
  assert.equal(completed.stopExecutions[ids.a].scheduledDayId, null);
  assert.equal(completed.stopExecutions[ids.b].scheduledDayId, null);
});

void test('End Day restores unfinished Current Do Now from Day 2', () => {
  const trip = fixtureTrip([ids.a]);
  const dayComplete = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );
  const overrideCurrent = accepted(
    doNowStop(trip, dayComplete, ids.x, changedAt),
  );
  const completed = accepted(endDay(trip, overrideCurrent, endedAt));

  assert.equal(completed.stopExecutions[ids.x].status, 'pending');
  assert.equal(completed.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(completed.currentStopId, undefined);
  assert.equal(completed.currentStepStartedAt, undefined);
  assert.equal(completed.currentInboundTravel, undefined);
  assert.deepEqual(completed.doNowQueue, []);
  assert.deepEqual(completed.completedDayIds, [dayOneId]);
});

void test('End Day restores unfinished Current Do Now to For Later', () => {
  const trip = fixtureTrip([ids.a]);
  const dayComplete = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );
  const overrideCurrent = accepted(
    doNowStop(trip, dayComplete, ids.y, changedAt),
  );
  const completed = accepted(endDay(trip, overrideCurrent, endedAt));

  assert.equal(completed.stopExecutions[ids.y].status, 'pending');
  assert.equal(completed.stopExecutions[ids.y].scheduledDayId, null);
  assert.deepEqual(completed.doNowQueue, []);
});

void test('Copenhagen last Done naturally completes Day 1 and the Trip', () => {
  let state = accepted(
    startDay(
      copenhagenTrip,
      createInitialTripExecutionState(copenhagenTrip, initializedAt),
      copenhagenTrip.days[0].id,
      startedAt,
    ),
  );
  for (let index = 0; index < copenhagenTrip.stops.length; index += 1) {
    state = accepted(completeCurrentStop(copenhagenTrip, state, changedAt));
  }

  assert.equal(copenhagenTrip.stops.length, 16);
  assert.equal(copenhagenTrip.days[0].plan.length, 16);
  assert.equal(state.executionDayId, copenhagenTrip.days[0].id);
  assert.deepEqual(state.completedDayIds, [copenhagenTrip.days[0].id]);
  assert.equal(
    tripExecutionLifecycle(copenhagenTrip, state).status,
    'TRIP_COMPLETE',
  );
  assert.equal(String(copenhagenAirport.id) in state.stopExecutions, false);
});

void test('final planned-day completion is terminal authority, not arbitrary ID coverage', () => {
  const trip = fixtureTrip([ids.a]);
  const active = activeState(trip);
  const invalidOrder: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    completedDayIds: [dayOneId, dayTwoId],
  };

  assert.equal(isTripComplete(trip, invalidOrder), false);
  assert.equal(
    tripExecutionLifecycle(trip, invalidOrder).status,
    'DAY_COMPLETE',
  );
  assert.equal(
    saveExecutionState(
      trip,
      invalidOrder,
      invalidOrder.lastUpdatedAt,
      new FakeStorage(),
    ).status,
    'invalid',
  );
});

void test('TRIP_COMPLETE remains terminal for ordinary execution mutations', () => {
  const trip = singleDayTrip();
  const terminal = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );
  const transitions = [
    startDay(trip, terminal, dayOneId, changedAt),
    completeCurrentStop(trip, terminal, changedAt),
    skipCurrentStop(trip, terminal, changedAt),
    saveCurrentForLater(trip, terminal, changedAt),
    doNowStop(trip, terminal, ids.y, changedAt),
    acknowledgeRuleRecommendation(trip, terminal, 'missing-rule', changedAt),
    reopenCompletedDay(trip, terminal, dayOneId, changedAt),
    endDay(trip, terminal, changedAt),
    saveAllForLaterAndEndDay(trip, terminal, changedAt),
  ];

  for (const result of transitions) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'TRIP_COMPLETE');
  }
});

void test('complete states have inactive projection and no stale execution timing', () => {
  const trip = fixtureTrip([ids.a]);
  const complete = accepted(
    completeCurrentStop(trip, activeState(trip), changedAt),
  );

  assert.deepEqual(projectSchedule(trip, complete, changedAt), {
    status: 'inactive',
    reason: 'day_complete',
    projectedStopIds: [],
  });
  assert.equal(complete.currentStepStartedAt, undefined);
  assert.equal(complete.currentInboundTravel, undefined);
});

void test('schema v3 reload preserves natural, reopened, recompleted, and zero-work states', () => {
  const trip = fixtureTrip([ids.a]);
  const natural = accepted(
    saveCurrentForLater(trip, activeState(trip), changedAt),
  );
  const loadedNatural = roundTrip(trip, natural);
  assert.equal(loadedNatural.executionDayId, dayOneId);
  assert.deepEqual(loadedNatural.completedDayIds, [dayOneId]);

  const reopened = accepted(doNowStop(trip, loadedNatural, ids.a, changedAt));
  const loadedReopened = roundTrip(trip, reopened);
  assert.deepEqual(loadedReopened.completedDayIds, []);
  assert.deepEqual(loadedReopened.doNowQueue, [
    { stopId: ids.a, returnScheduledDayId: null },
  ]);

  const recompleted = accepted(
    completeCurrentStop(trip, loadedReopened, changedAt),
  );
  assert.deepEqual(roundTrip(trip, recompleted).completedDayIds, [dayOneId]);

  const zeroTrip = zeroWorkTrip();
  const zeroOpen = activeState(zeroTrip);
  assert.deepEqual(roundTrip(zeroTrip, zeroOpen).completedDayIds, []);
  const zeroTerminal = accepted(endDay(zeroTrip, zeroOpen, endedAt));
  assert.equal(
    tripExecutionLifecycle(zeroTrip, roundTrip(zeroTrip, zeroTerminal)).status,
    'TRIP_COMPLETE',
  );

  const finalTrip = singleDayTrip();
  const finalNatural = accepted(
    completeCurrentStop(finalTrip, activeState(finalTrip), changedAt),
  );
  assert.equal(
    tripExecutionLifecycle(finalTrip, roundTrip(finalTrip, finalNatural))
      .status,
    'TRIP_COMPLETE',
  );
});

void test('schema v3 reload preserves save-all and restored queue contexts', () => {
  const trip = fixtureTrip();
  let active = activeState(trip);
  active = accepted(doNowStop(trip, active, ids.x, changedAt));
  active = accepted(doNowStop(trip, active, ids.y, changedAt));
  const completed = accepted(saveAllForLaterAndEndDay(trip, active, endedAt));
  const loaded = roundTrip(trip, completed);

  assert.deepEqual(loaded.doNowQueue, []);
  assert.equal(loaded.executionDayId, dayOneId);
  assert.equal(loaded.stopExecutions[ids.a].scheduledDayId, null);
  assert.equal(loaded.stopExecutions[ids.b].scheduledDayId, null);
  assert.equal(loaded.stopExecutions[ids.x].scheduledDayId, dayTwoId);
  assert.equal(loaded.stopExecutions[ids.y].scheduledDayId, null);
});

void test('PostDayDestination stays static and separately navigable', () => {
  assert.equal(copenhagenTrip.days[0].postDayDestination, copenhagenAirport);
  assert.equal(copenhagenTrip.stops.length, 16);
  const url = new URL(postDayGoogleMapsNavigationUrl(copenhagenAirport));
  assert.equal(url.searchParams.get('destination'), 'Copenhagen Airport');
  assert.equal(url.searchParams.get('travelmode'), 'transit');
});

void test('production UI exposes bounded End Day resolution and same-day Do Now', () => {
  const source = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /END_DAY_REQUIRES_RESOLUTION/);
  assert.match(source, />\s*Save all for later\s*</);
  assert.match(source, />\s*Review individually\s*</);
  assert.match(source, />\s*Cancel\s*</);
  assert.match(source, /doNowStop\(/);
  assert.match(source, />\s*Do now\s*</);
  assert.match(source, /postDayGoogleMapsNavigationUrl/);
});
