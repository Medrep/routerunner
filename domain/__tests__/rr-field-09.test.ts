import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { manualSkipCurrentStop } from '../../components/routerunner/manual-skip.ts';
import {
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import { krakowField06Trip, krakowStopIds } from '../../data/trips/krakow.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  saveCurrentForLater,
  skipCurrentStop,
  startDay,
} from '../index.ts';
import type { TransitionResult, Trip, TripExecutionState } from '../index.ts';

const initializedAt = '2026-09-12T10:00:00.000Z';
const startedAt = '2026-09-12T11:00:00.000Z';
const changedAt = '2026-09-12T11:05:00.000Z';

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function startedState(trip: Trip): TripExecutionState {
  return accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      trip.days[0].id,
      startedAt,
    ),
  );
}

function stateAtStop(trip: Trip, stopId: string): TripExecutionState {
  let state = startedState(trip);
  while (state.currentStopId !== stopId) {
    state = accepted(completeCurrentStop(trip, state, changedAt));
  }
  return state;
}

void test('Kraków MIT manual Skip cancellation preserves Current execution exactly', () => {
  const state = stateAtStop(krakowField06Trip, krakowStopIds.mitZajezdnia);
  const before = structuredClone(state);
  const prompts: string[] = [];

  const result = manualSkipCurrentStop(
    krakowField06Trip,
    state,
    changedAt,
    (message) => {
      prompts.push(message);
      return false;
    },
  );

  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(prompts, [
    'Skip must-see stop Muzeum Inżynierii i Techniki — Zajezdnia?',
  ]);
  assert.deepEqual(state, before);
  assert.equal(state.currentStopId, krakowStopIds.mitZajezdnia);
  assert.equal(
    state.stopExecutions[krakowStopIds.mitZajezdnia].status,
    'pending',
  );
});

void test('Kraków MIT confirmed manual Skip invokes canonical Current Skip', () => {
  const state = stateAtStop(krakowField06Trip, krakowStopIds.mitZajezdnia);
  const expected = skipCurrentStop(krakowField06Trip, state, changedAt);
  let confirmations = 0;

  const result = manualSkipCurrentStop(
    krakowField06Trip,
    state,
    changedAt,
    () => {
      confirmations += 1;
      return true;
    },
  );

  assert.equal(result.status, 'transition');
  assert.equal(confirmations, 1);
  assert.deepEqual(result.result, expected);
  assert.equal(result.result.ok, true);
  assert.equal(
    result.result.state.stopExecutions[krakowStopIds.mitZajezdnia].status,
    'skipped',
  );
  assert.equal(result.result.state.currentStopId, krakowStopIds.halaTargowa);
  assert.equal(result.result.state.currentStepStartedAt, changedAt);
  assert.deepEqual(result.result.state.currentInboundTravel, {
    fromStopId: krakowStopIds.mitZajezdnia,
    toStopId: krakowStopIds.halaTargowa,
    duration: { status: 'unknown', reason: 'unresolved' },
  });
});

for (const [label, trip, stopId] of [
  ['normal', krakowField06Trip, krakowStopIds.placWolnica],
  ['optional', copenhagenTrip, copenhagenStopIds.reffen],
] as const) {
  void test(`${label} manual Skip remains one action without confirmation`, () => {
    const state = stateAtStop(trip, stopId);
    const expected = skipCurrentStop(trip, state, changedAt);

    const result = manualSkipCurrentStop(trip, state, changedAt, () => {
      assert.fail(`${label} Skip must not request confirmation.`);
    });

    assert.equal(result.status, 'transition');
    assert.deepEqual(result.result, expected);
  });
}

void test('must-stop Done and Save for Later remain direct canonical transitions', () => {
  const state = stateAtStop(krakowField06Trip, krakowStopIds.mitZajezdnia);

  assert.equal(
    completeCurrentStop(krakowField06Trip, state, changedAt).ok,
    true,
  );
  assert.equal(
    saveCurrentForLater(krakowField06Trip, state, changedAt).ok,
    true,
  );
});

void test('the sole production manual Skip entry point uses the confirmation boundary', () => {
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.match(/onClick=\{skip\}/g)?.length, 1);
  assert.equal(pageSource.includes('skipCurrentStop('), false);
  assert.match(
    pageSource,
    /function skip\(\)[\s\S]*?manualSkipCurrentStop\([\s\S]*?window\.confirm\(message\)[\s\S]*?status === 'cancelled'\) return;[\s\S]*?apply\(/,
  );
});
