import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  copenhagenAirport,
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  clearExecutionState,
  completeCurrentStop,
  createInitialTripExecutionState,
  deserializeExecutionState,
  EXECUTION_STATE_SCHEMA_VERSION,
  executionStorageKey,
  loadExecutionState,
  restoreOrCreateExecutionState,
  saveCurrentForLater,
  saveExecutionState,
  skipCurrentStop,
  startDay,
} from '../index.ts';
import type {
  ExecutionStorage,
  StopId,
  TransitionResult,
  TripExecutionState,
} from '../index.ts';

const dayId = 'copenhagen-day-1';
const initializedAt = '2026-09-08T08:00:00.000Z';
const startedAt = '2026-09-08T08:05:00.000Z';
const changedAt = '2026-09-08T08:35:00.000Z';

type MutableEnvelope = {
  version: number;
  tripId: string;
  savedAt: string;
  state: Record<string, unknown> & {
    tripId: string;
    currentStopId?: string;
    executionDayId?: string;
    lastUpdatedAt: string;
    stopExecutions: Record<string, Record<string, unknown>>;
    doNowQueue: Array<Record<string, unknown>>;
    completedDayIds: string[];
  };
};

class FakeStorage implements ExecutionStorage {
  readonly values = new Map<string, string>();
  readError?: Error;
  writeError?: Error;
  removeError?: Error;
  writes = 0;

  getItem(key: string): string | null {
    if (this.readError) throw this.readError;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.writeError) throw this.writeError;
    this.writes += 1;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.removeError) throw this.removeError;
    this.values.delete(key);
  }
}

function initialState() {
  return createInitialTripExecutionState(copenhagenTrip, initializedAt);
}

function successfulState(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function activeState() {
  return successfulState(
    startDay(copenhagenTrip, initialState(), dayId, startedAt),
  );
}

function roundTrip(state: TripExecutionState) {
  const storage = new FakeStorage();
  assert.deepEqual(
    saveExecutionState(copenhagenTrip, state, state.lastUpdatedAt, storage),
    { status: 'saved', savedAt: state.lastUpdatedAt },
  );
  const loaded = loadExecutionState(copenhagenTrip, storage);
  assert.equal(loaded.status, 'restored');
  assert.deepEqual(loaded.state, state);
  return { storage, loaded };
}

function savedEnvelope(state: TripExecutionState = activeState()) {
  const storage = new FakeStorage();
  const result = saveExecutionState(
    copenhagenTrip,
    state,
    state.lastUpdatedAt,
    storage,
  );
  assert.equal(result.status, 'saved');
  return JSON.parse(
    storage.getItem(executionStorageKey(copenhagenTrip.id))!,
  ) as MutableEnvelope;
}

void test('uses a deterministic, trip-specific namespaced storage key', () => {
  assert.equal(
    executionStorageKey(copenhagenTrip.id),
    'routerunner:execution:copenhagen',
  );
  assert.notEqual(
    executionStorageKey(copenhagenTrip.id),
    executionStorageKey('rome'),
  );
});

void test('persists a versioned, trip-bound envelope with deterministic savedAt', () => {
  const state = activeState();
  const envelope = savedEnvelope(state);

  assert.equal(envelope.version, EXECUTION_STATE_SCHEMA_VERSION);
  assert.equal(envelope.tripId, copenhagenTrip.id);
  assert.equal(envelope.savedAt, state.lastUpdatedAt);
  assert.deepEqual(envelope.state, state);
});

void test('round-trips fresh pre-start execution state', () => {
  roundTrip(initialState());
});

void test('round-trips Start Day with Nyhavn Current and unknown duration', () => {
  const state = activeState();
  const { loaded } = roundTrip(state);

  assert.equal(loaded.state.currentStopId, copenhagenStopIds.nyhavn);
  assert.equal(loaded.state.executionDayId, dayId);
  assert.equal(loaded.state.executionDayStartedAt, startedAt);
  assert.deepEqual(loaded.state.currentInboundTravel?.duration, {
    status: 'unknown',
    reason: 'unresolved',
  });
  const typedStopId: StopId = loaded.state.currentStopId!;
  assert.equal(typedStopId, copenhagenStopIds.nyhavn);
  assert.ok(
    Object.values(loaded.state.stopExecutions).every(
      (execution) => execution.status === 'pending',
    ),
  );
});

void test('round-trips Done with completion history and next Current', () => {
  const state = successfulState(
    completeCurrentStop(copenhagenTrip, activeState(), changedAt),
  );
  const planBefore = structuredClone(copenhagenTrip.days[0].plan);
  const { loaded } = roundTrip(state);

  assert.equal(
    loaded.state.stopExecutions[copenhagenStopIds.nyhavn].status,
    'completed',
  );
  assert.equal(
    loaded.state.stopExecutions[copenhagenStopIds.nyhavn].completedOnDayId,
    dayId,
  );
  assert.equal(loaded.state.currentStopId, copenhagenStopIds.amalienborg);
  assert.deepEqual(copenhagenTrip.days[0].plan, planBefore);
});

void test('round-trips Skip without inventing completion history', () => {
  const state = successfulState(
    skipCurrentStop(copenhagenTrip, activeState(), changedAt),
  );
  const { loaded } = roundTrip(state);
  const skipped = loaded.state.stopExecutions[copenhagenStopIds.nyhavn];

  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.completedRecordedAt, undefined);
  assert.equal(skipped.completedOnDayId, undefined);
  assert.equal(loaded.state.currentStopId, copenhagenStopIds.amalienborg);
});

void test('round-trips Save for Later as pending and unscheduled', () => {
  const state = successfulState(
    saveCurrentForLater(copenhagenTrip, activeState(), changedAt),
  );
  const { loaded } = roundTrip(state);
  const saved = loaded.state.stopExecutions[copenhagenStopIds.nyhavn];

  assert.equal(saved.status, 'pending');
  assert.equal(saved.scheduledDayId, null);
  assert.equal(loaded.state.currentStopId, copenhagenStopIds.amalienborg);
  assert.equal(copenhagenTrip.days[0].plan[0].stopId, copenhagenStopIds.nyhavn);
});

void test('preserves an active day with no Current and does not complete it', () => {
  const {
    currentStopId: _currentStopId,
    currentStepStartedAt: _currentStepStartedAt,
    currentInboundTravel: _currentInboundTravel,
    ...withoutCurrent
  } = activeState();
  const state: TripExecutionState = { ...withoutCurrent, completedDayIds: [] };
  const { loaded } = roundTrip(state);

  assert.equal(loaded.state.executionDayId, dayId);
  assert.equal(loaded.state.currentStopId, undefined);
  assert.equal(loaded.state.currentStepStartedAt, undefined);
  assert.equal(loaded.state.currentInboundTravel, undefined);
  assert.deepEqual(loaded.state.completedDayIds, []);
});

void test('preserves populated future-contract arrays without adding behavior', () => {
  const state: TripExecutionState = {
    ...activeState(),
    doNowQueue: [
      {
        stopId: copenhagenStopIds.reffen,
        returnScheduledDayId: dayId,
      },
    ],
    completedDayIds: [dayId],
    ruleAcknowledgements: [
      {
        ruleId: 'copenhagen-reffen-buffer-below-30',
        acknowledgedAt: changedAt,
      },
    ],
  };
  const { loaded } = roundTrip(state);

  assert.deepEqual(loaded.state.doNowQueue, state.doNowQueue);
  assert.deepEqual(loaded.state.completedDayIds, state.completedDayIds);
  assert.deepEqual(
    loaded.state.ruleAcknowledgements,
    state.ruleAcknowledgements,
  );
});

void test('rejects malformed JSON', () => {
  assert.deepEqual(deserializeExecutionState('{not-json', copenhagenTrip), {
    status: 'invalid',
    reason: 'Persisted execution JSON is malformed.',
  });
});

void test('rejects incompatible and structurally invalid persisted states', async (t) => {
  const cases: Array<{
    name: string;
    mutate: (envelope: MutableEnvelope) => void;
  }> = [
    {
      name: 'unsupported envelope version',
      mutate: (envelope) => {
        envelope.version = 2;
      },
    },
    {
      name: 'envelope trip mismatch',
      mutate: (envelope) => {
        envelope.tripId = 'rome';
      },
    },
    {
      name: 'invalid envelope savedAt',
      mutate: (envelope) => {
        envelope.savedAt = 'yesterday';
      },
    },
    {
      name: 'state trip mismatch',
      mutate: (envelope) => {
        envelope.state.tripId = 'rome';
      },
    },
    {
      name: 'unknown currentStopId',
      mutate: (envelope) => {
        envelope.state.currentStopId = 'missing-stop';
      },
    },
    {
      name: 'unknown StopExecution ID',
      mutate: (envelope) => {
        envelope.state.stopExecutions['missing-stop'] = {
          stopId: 'missing-stop',
          status: 'pending',
          scheduledDayId: dayId,
        };
      },
    },
    {
      name: 'missing required StopExecution',
      mutate: (envelope) => {
        delete envelope.state.stopExecutions[copenhagenStopIds.nyhavn];
      },
    },
    {
      name: 'invalid StopExecution status',
      mutate: (envelope) => {
        envelope.state.stopExecutions[copenhagenStopIds.nyhavn].status =
          'visited';
      },
    },
    {
      name: 'unknown executionDayId',
      mutate: (envelope) => {
        envelope.state.executionDayId = 'missing-day';
      },
    },
    {
      name: 'unknown scheduledDayId',
      mutate: (envelope) => {
        envelope.state.stopExecutions[copenhagenStopIds.nyhavn].scheduledDayId =
          'missing-day';
      },
    },
    {
      name: 'unknown completedOnDayId',
      mutate: (envelope) => {
        envelope.state.stopExecutions[
          copenhagenStopIds.nyhavn
        ].completedOnDayId = 'missing-day';
      },
    },
    {
      name: 'invalid queue stopId',
      mutate: (envelope) => {
        envelope.state.doNowQueue = [
          { stopId: 'missing-stop', returnScheduledDayId: dayId },
        ];
      },
    },
    {
      name: 'invalid queue return day',
      mutate: (envelope) => {
        envelope.state.doNowQueue = [
          {
            stopId: copenhagenStopIds.nyhavn,
            returnScheduledDayId: 'missing-day',
          },
        ];
      },
    },
    {
      name: 'unknown completed day',
      mutate: (envelope) => {
        envelope.state.completedDayIds = ['missing-day'];
      },
    },
    {
      name: 'invalid execution timestamp',
      mutate: (envelope) => {
        envelope.state.lastUpdatedAt = 'yesterday';
      },
    },
    {
      name: 'post-day destination used as sightseeing execution',
      mutate: (envelope) => {
        envelope.state.stopExecutions[String(copenhagenAirport.id)] = {
          stopId: copenhagenAirport.id,
          status: 'pending',
          scheduledDayId: dayId,
        };
      },
    },
  ];

  for (const invalidCase of cases) {
    await t.test(invalidCase.name, () => {
      const envelope = savedEnvelope();
      invalidCase.mutate(envelope);
      const result = deserializeExecutionState(
        JSON.stringify(envelope),
        copenhagenTrip,
      );
      assert.equal(result.status, 'invalid');
    });
  }
});

void test('falls back atomically to fresh state for invalid persisted data', () => {
  const storage = new FakeStorage();
  storage.values.set(executionStorageKey(copenhagenTrip.id), '{bad-json');

  const result = restoreOrCreateExecutionState(
    copenhagenTrip,
    initializedAt,
    storage,
  );
  assert.equal(result.loadResult.status, 'invalid');
  assert.deepEqual(result.state, initialState());
});

void test('first visit with empty storage uses the accepted fresh initializer', () => {
  const result = restoreOrCreateExecutionState(
    copenhagenTrip,
    initializedAt,
    new FakeStorage(),
  );

  assert.deepEqual(result.loadResult, { status: 'empty' });
  assert.deepEqual(result.state, initialState());
});

void test('restores accepted state instead of recomputing from static planning', () => {
  const accepted = successfulState(
    completeCurrentStop(copenhagenTrip, activeState(), changedAt),
  );
  const storage = roundTrip(accepted).storage;

  const result = restoreOrCreateExecutionState(
    copenhagenTrip,
    '2026-09-08T09:00:00.000Z',
    storage,
  );
  assert.equal(result.loadResult.status, 'restored');
  assert.deepEqual(result.state, accepted);
});

void test('handles read, write, and clear failures without throwing or mutating state', () => {
  const state = activeState();
  const before = structuredClone(state);
  const storage = new FakeStorage();

  storage.readError = new Error('read blocked');
  assert.deepEqual(loadExecutionState(copenhagenTrip, storage), {
    status: 'unavailable',
    operation: 'read',
    reason: 'read blocked',
  });

  storage.writeError = new Error('quota exceeded');
  assert.deepEqual(
    saveExecutionState(copenhagenTrip, state, state.lastUpdatedAt, storage),
    {
      status: 'unavailable',
      operation: 'write',
      reason: 'quota exceeded',
    },
  );
  assert.deepEqual(state, before);

  storage.removeError = new Error('remove blocked');
  assert.deepEqual(clearExecutionState(copenhagenTrip, storage), {
    status: 'unavailable',
    operation: 'clear',
    reason: 'remove blocked',
  });
});

void test('clear removes only the requested trip key', () => {
  const storage = new FakeStorage();
  storage.values.set(executionStorageKey(copenhagenTrip.id), 'copenhagen');
  storage.values.set(executionStorageKey('rome'), 'rome');

  assert.deepEqual(clearExecutionState(copenhagenTrip, storage), {
    status: 'cleared',
  });
  assert.equal(storage.getItem(executionStorageKey(copenhagenTrip.id)), null);
  assert.equal(storage.getItem(executionStorageKey('rome')), 'rome');
});

void test('a failed transition leaves the last accepted persisted envelope unchanged', () => {
  const state = activeState();
  const { storage } = roundTrip(state);
  const key = executionStorageKey(copenhagenTrip.id);
  const before = storage.getItem(key);
  const failed = startDay(copenhagenTrip, state, dayId, changedAt);

  assert.equal(failed.ok, false);
  assert.equal(storage.getItem(key), before);
  assert.equal(storage.writes, 1);
});

void test('production page restores once hydrated and persists authoritative changes', () => {
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(pageSource, /restoreOrCreateExecutionState\(/);
  assert.match(pageSource, /saveExecutionState\(/);
  assert.match(pageSource, /useSyncExternalStore\(/);
  assert.doesNotMatch(pageSource, /design-reference/);
  assert.doesNotMatch(pageSource, /localStorage/);
});

void test('server-side persistence access is unavailable instead of throwing', () => {
  assert.deepEqual(loadExecutionState(copenhagenTrip), {
    status: 'unavailable',
    operation: 'read',
    reason: 'Browser storage is unavailable.',
  });
});
