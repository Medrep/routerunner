import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  copenhagenAirport,
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  acceptSkipRecommendation,
  acknowledgeRuleRecommendation,
  activeExecutionRecommendation,
  completeCurrentStop,
  createInitialTripExecutionState,
  endDay,
  loadExecutionState,
  postDayGoogleMapsNavigationUrl,
  projectSchedule,
  reopenCompletedDay,
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

const dayOneId = 'copenhagen-day-1';
const dayTwoId = 'copenhagen-day-2';
const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:05:00.000Z';
const endedAt = '2026-09-08T18:30:00.000Z';
const reopenedAt = '2026-09-08T19:00:00.000Z';
const ruleId = 'copenhagen-reffen-buffer-below-30';

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

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function multiDayTrip(): Trip {
  return {
    ...copenhagenTrip,
    endDate: '2026-09-09',
    days: [
      copenhagenTrip.days[0],
      { id: dayTwoId, date: '2026-09-09', title: 'Day 2', plan: [] },
    ],
  };
}

function activeState(trip: Trip = copenhagenTrip, dayId = dayOneId) {
  return accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      dayId,
      startedAt,
    ),
  );
}

function completeAllCurrent(trip: Trip, input = activeState(trip)) {
  let state = input;
  while (state.currentStopId) {
    state = accepted(completeCurrentStop(trip, state, endedAt));
  }
  return state;
}

function resolvedWithHistory(trip: Trip = multiDayTrip()) {
  let state = activeState(trip);
  state = accepted(saveCurrentForLater(trip, state, endedAt));
  state = accepted(skipCurrentStop(trip, state, endedAt));
  state = completeAllCurrent(trip, state);
  return {
    ...state,
    ruleAcknowledgements: [
      {
        ruleId,
        executionDayId: dayOneId,
        severity: 'SCHEDULE_TIGHT' as const,
        acknowledgedAt: endedAt,
      },
    ],
  };
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

void test('Current exhaustion is not automatic Day Complete', () => {
  const exhausted = completeAllCurrent(copenhagenTrip);

  assert.equal(exhausted.executionDayId, dayOneId);
  assert.equal(exhausted.currentStopId, undefined);
  assert.deepEqual(exhausted.completedDayIds, []);
  assert.deepEqual(tripExecutionLifecycle(copenhagenTrip, exhausted), {
    status: 'ACTIVE',
    dayId: dayOneId,
  });
});

void test('End Day rejects executable Current work without mutating it', () => {
  const state = activeState();
  const before = structuredClone(state);
  const result = endDay(copenhagenTrip, state, endedAt);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EXECUTABLE_WORK_REMAINS');
  assert.deepEqual(state, before);
});

void test('End Day cannot auto-Skip or auto-Save unresolved scheduled work', () => {
  const active = activeState();
  const unresolvedWithoutCurrent: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
  };
  const before = structuredClone(unresolvedWithoutCurrent.stopExecutions);
  const result = endDay(copenhagenTrip, unresolvedWithoutCurrent, endedAt);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EXECUTABLE_WORK_REMAINS');
  assert.deepEqual(unresolvedWithoutCurrent.stopExecutions, before);
  assert.equal(
    unresolvedWithoutCurrent.stopExecutions[copenhagenStopIds.nyhavn].status,
    'pending',
  );
  assert.equal(
    unresolvedWithoutCurrent.stopExecutions[copenhagenStopIds.nyhavn]
      .scheduledDayId,
    dayOneId,
  );
});

void test('explicit final End Day completes Copenhagen and clears active timing', () => {
  const exhausted = completeAllCurrent(copenhagenTrip);
  const result = endDay(copenhagenTrip, exhausted, endedAt);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.completedDayIds, [dayOneId]);
  assert.equal(result.state.executionDayId, undefined);
  assert.equal(result.state.executionDayStartedAt, undefined);
  assert.equal(result.state.currentStopId, undefined);
  assert.equal(result.state.currentStepStartedAt, undefined);
  assert.equal(result.state.currentInboundTravel, undefined);
  assert.deepEqual(tripExecutionLifecycle(copenhagenTrip, result.state), {
    status: 'TRIP_COMPLETE',
    dayId: dayOneId,
  });
});

void test('completedDayIds retains set semantics across repeated End Day attempts', () => {
  const trip = multiDayTrip();
  const completed = accepted(endDay(trip, completeAllCurrent(trip), endedAt));
  const repeatedInput: TripExecutionState = {
    ...completed,
    executionDayId: dayOneId,
    executionDayStartedAt: startedAt,
  };
  const repeated = endDay(trip, repeatedInput, endedAt);

  assert.deepEqual(completed.completedDayIds, [dayOneId]);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error.code, 'DAY_ALREADY_COMPLETED');
  assert.deepEqual(repeatedInput.completedDayIds, [dayOneId]);
});

void test('non-final End Day produces DAY_COMPLETE without starting Day 2', () => {
  const trip = multiDayTrip();
  const state = accepted(endDay(trip, completeAllCurrent(trip), endedAt));

  assert.deepEqual(tripExecutionLifecycle(trip, state), {
    status: 'DAY_COMPLETE',
    dayId: dayOneId,
  });
  assert.equal(state.executionDayId, undefined);
  assert.deepEqual(state.completedDayIds, [dayOneId]);
});

void test('zero-work day stays active until explicit End Day', () => {
  const trip = multiDayTrip();
  const dayOneComplete = accepted(
    endDay(trip, completeAllCurrent(trip), endedAt),
  );
  const zeroWork = accepted(
    startDay(trip, dayOneComplete, dayTwoId, startedAt),
  );

  assert.equal(zeroWork.currentStopId, undefined);
  assert.deepEqual(zeroWork.completedDayIds, [dayOneId]);
  assert.deepEqual(tripExecutionLifecycle(trip, zeroWork), {
    status: 'ACTIVE',
    dayId: dayTwoId,
  });

  const terminal = accepted(endDay(trip, zeroWork, endedAt));
  assert.deepEqual(terminal.completedDayIds, [dayOneId, dayTwoId]);
  assert.equal(tripExecutionLifecycle(trip, terminal).status, 'TRIP_COMPLETE');
});

void test('final zero-work day can complete while For Later remains pending', () => {
  const trip = multiDayTrip();
  const resolved = resolvedWithHistory(trip);
  const dayOneComplete = accepted(endDay(trip, resolved, endedAt));
  const zeroWork = accepted(
    startDay(trip, dayOneComplete, dayTwoId, startedAt),
  );
  const terminal = accepted(endDay(trip, zeroWork, endedAt));

  assert.equal(
    terminal.stopExecutions[copenhagenStopIds.nyhavn].status,
    'pending',
  );
  assert.equal(
    terminal.stopExecutions[copenhagenStopIds.nyhavn].scheduledDayId,
    null,
  );
  assert.equal(tripExecutionLifecycle(trip, terminal).status, 'TRIP_COMPLETE');
});

void test('End Day preserves Done, Skip, For Later, acknowledgements, and plans', () => {
  const trip = multiDayTrip();
  const resolved = resolvedWithHistory(trip);
  const historyBefore = structuredClone(resolved.stopExecutions);
  const acknowledgementsBefore = structuredClone(resolved.ruleAcknowledgements);
  const tripBefore = structuredClone(trip);
  const ended = accepted(endDay(trip, resolved, endedAt));

  assert.deepEqual(ended.stopExecutions, historyBefore);
  assert.deepEqual(ended.ruleAcknowledgements, acknowledgementsBefore);
  assert.equal(
    ended.stopExecutions[copenhagenStopIds.amalienborg].status,
    'skipped',
  );
  assert.equal(
    ended.stopExecutions[copenhagenStopIds.nyhavn].scheduledDayId,
    null,
  );
  assert.deepEqual(trip, tripBefore);
});

void test('End Day rejects queued Do Now work and leaves the queue intact', () => {
  const trip = multiDayTrip();
  const resolved = resolvedWithHistory(trip);
  const queued: TripExecutionState = {
    ...resolved,
    doNowQueue: [
      {
        stopId: copenhagenStopIds.nyhavn,
        returnScheduledDayId: null,
      },
    ],
  };
  const result = endDay(trip, queued, endedAt);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DO_NOW_QUEUE_NOT_EMPTY');
  assert.deepEqual(queued.doNowQueue, [
    { stopId: copenhagenStopIds.nyhavn, returnScheduledDayId: null },
  ]);
});

void test('reopen removes only a non-terminal completed-day marker', () => {
  const trip = multiDayTrip();
  const ended = accepted(endDay(trip, resolvedWithHistory(trip), endedAt));
  const before = structuredClone(ended);
  const reopened = accepted(
    reopenCompletedDay(trip, ended, dayOneId, reopenedAt),
  );

  assert.deepEqual(reopened.completedDayIds, []);
  assert.equal(reopened.executionDayId, undefined);
  assert.equal(reopened.currentStopId, undefined);
  assert.deepEqual(reopened.stopExecutions, before.stopExecutions);
  assert.deepEqual(reopened.doNowQueue, before.doNowQueue);
  assert.deepEqual(reopened.ruleAcknowledgements, before.ruleAcknowledgements);
  assert.equal(reopened.lastUpdatedAt, reopenedAt);
});

void test('reopen rejects missing, incomplete, and terminal days', () => {
  const trip = multiDayTrip();
  const initial = createInitialTripExecutionState(trip, initializedAt);
  const missing = reopenCompletedDay(trip, initial, 'missing-day', reopenedAt);
  const incomplete = reopenCompletedDay(trip, initial, dayOneId, reopenedAt);

  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'DAY_NOT_FOUND');
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.error.code, 'DAY_NOT_COMPLETED');

  const dayOneComplete = accepted(
    endDay(trip, completeAllCurrent(trip), endedAt),
  );
  const dayTwoActive = accepted(
    startDay(trip, dayOneComplete, dayTwoId, startedAt),
  );
  const terminal = accepted(endDay(trip, dayTwoActive, endedAt));
  const terminalReopen = reopenCompletedDay(
    trip,
    terminal,
    dayOneId,
    reopenedAt,
  );
  assert.equal(terminalReopen.ok, false);
  assert.equal(terminalReopen.error.code, 'TRIP_COMPLETE');
});

void test('TRIP_COMPLETE rejects every ordinary execution mutation', () => {
  const terminal = accepted(
    endDay(copenhagenTrip, completeAllCurrent(copenhagenTrip), endedAt),
  );
  const transitions = [
    startDay(copenhagenTrip, terminal, dayOneId, reopenedAt),
    completeCurrentStop(copenhagenTrip, terminal, reopenedAt),
    skipCurrentStop(copenhagenTrip, terminal, reopenedAt),
    saveCurrentForLater(copenhagenTrip, terminal, reopenedAt),
    acceptSkipRecommendation(copenhagenTrip, terminal, ruleId, reopenedAt),
    acknowledgeRuleRecommendation(copenhagenTrip, terminal, ruleId, reopenedAt),
    reopenCompletedDay(copenhagenTrip, terminal, dayOneId, reopenedAt),
    endDay(copenhagenTrip, terminal, reopenedAt),
  ];

  for (const result of transitions) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'TRIP_COMPLETE');
  }
});

void test('terminal projection has no active recommendation or alerts', () => {
  const terminal = accepted(
    endDay(copenhagenTrip, completeAllCurrent(copenhagenTrip), endedAt),
  );
  const projection = projectSchedule(copenhagenTrip, terminal, reopenedAt);

  assert.deepEqual(projection, {
    status: 'inactive',
    reason: 'trip_complete',
    projectedStopIds: [],
  });
  assert.equal(
    activeExecutionRecommendation(copenhagenTrip, terminal, projection),
    undefined,
  );
});

void test('DAY_COMPLETE projection is inactive without stale execution data', () => {
  const trip = multiDayTrip();
  const dayComplete = accepted(endDay(trip, completeAllCurrent(trip), endedAt));

  assert.deepEqual(projectSchedule(trip, dayComplete, reopenedAt), {
    status: 'inactive',
    reason: 'day_complete',
    projectedStopIds: [],
  });
});

void test('Copenhagen keeps Airport static and outside all 16 Stops', () => {
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.equal(copenhagenTrip.days[0].plan.length, 16);
  assert.equal(copenhagenTrip.days[0].postDayDestination, copenhagenAirport);
  assert.equal(
    copenhagenTrip.stops.some(
      (stop) => String(stop.id) === String(copenhagenAirport.id),
    ),
    false,
  );
  assert.equal(
    String(copenhagenAirport.id) in
      createInitialTripExecutionState(copenhagenTrip, initializedAt)
        .stopExecutions,
    false,
  );
  const url = new URL(postDayGoogleMapsNavigationUrl(copenhagenAirport));
  assert.equal(url.searchParams.get('destination'), 'Copenhagen Airport');
  assert.equal(url.searchParams.get('travelmode'), 'transit');
});

void test('reload preserves DAY_COMPLETE, reopened, and TRIP_COMPLETE states', () => {
  const trip = multiDayTrip();
  const dayComplete = accepted(endDay(trip, completeAllCurrent(trip), endedAt));
  const loadedDayComplete = roundTrip(trip, dayComplete);
  assert.equal(
    tripExecutionLifecycle(trip, loadedDayComplete).status,
    'DAY_COMPLETE',
  );

  const reopened = accepted(
    reopenCompletedDay(trip, loadedDayComplete, dayOneId, reopenedAt),
  );
  const loadedReopened = roundTrip(trip, reopened);
  assert.deepEqual(loadedReopened.completedDayIds, []);
  assert.deepEqual(loadedReopened.stopExecutions, reopened.stopExecutions);

  const dayTwoActive = accepted(
    startDay(trip, dayComplete, dayTwoId, startedAt),
  );
  const terminal = accepted(endDay(trip, dayTwoActive, endedAt));
  const loadedTerminal = roundTrip(trip, terminal);
  assert.equal(
    tripExecutionLifecycle(trip, loadedTerminal).status,
    'TRIP_COMPLETE',
  );
  assert.equal(
    loadedTerminal.stopExecutions[copenhagenStopIds.nyhavn].completedOnDayId,
    dayOneId,
  );
});

void test('persistence rejects duplicate or active completed-day identities', () => {
  const trip = multiDayTrip();
  const dayComplete = accepted(endDay(trip, completeAllCurrent(trip), endedAt));
  const storage = new FakeStorage();

  assert.equal(
    saveExecutionState(
      trip,
      { ...dayComplete, completedDayIds: [dayOneId, dayOneId] },
      endedAt,
      storage,
    ).status,
    'invalid',
  );
  assert.equal(
    saveExecutionState(
      trip,
      {
        ...dayComplete,
        executionDayId: dayOneId,
        executionDayStartedAt: startedAt,
      },
      endedAt,
      storage,
    ).status,
    'invalid',
  );
});

void test('production presentation exposes only bounded completion actions', () => {
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(pageSource, /<Flag size=\{20\} \/> End Day/);
  assert.match(pageSource, /'Trip complete'/);
  assert.match(pageSource, /'Day complete'/);
  assert.match(pageSource, /postDayGoogleMapsNavigationUrl/);
  assert.match(pageSource, /Directions to/);
  assert.match(
    pageSource,
    /lifecycle\.status === 'READY' &&[\s\S]*?detail === firstPreparedStopId/,
  );
});
