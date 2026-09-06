import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  DoNowQueueEntry,
  KnownOrUnknownDuration,
  StopExecution,
  StopExecutionStatus,
  TripExecutionState,
} from '../execution/types.ts';
import { originalPlannedDayId } from '../trip/original-planned-day.ts';
import type { PostDayDestination, Trip } from '../trip/types.ts';

type HasCurrentField = 'current' extends keyof StopExecution ? true : false;
type AllowsCurrentStatus = 'current' extends StopExecutionStatus ? true : false;

const stopExecutionHasNoCurrentField: HasCurrentField = false;
const stopExecutionHasNoCurrentStatus: AllowsCurrentStatus = false;

const trip: Trip = {
  id: 'rome',
  title: 'Rome',
  city: 'Rome',
  timeZone: 'Europe/Rome',
  startDate: '2026-09-06',
  endDate: '2026-09-07',
  stops: [
    {
      id: 'colosseum',
      name: 'Colosseum',
      latitude: 41.8902,
      longitude: 12.4922,
      priority: 'must',
      canSkip: false,
      plannedVisitMinutes: 90,
    },
    {
      id: 'trevi',
      name: 'Trevi Fountain',
      latitude: 41.9009,
      longitude: 12.4833,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 30,
    },
  ],
  days: [
    {
      id: 'day-1',
      date: '2026-09-06',
      plan: [{ stopId: 'colosseum', order: 1 }],
    },
    {
      id: 'day-2',
      date: '2026-09-07',
      plan: [{ stopId: 'trevi', order: 1 }],
      postDayDestination: {
        id: 'rome-airport',
        name: 'Rome Fiumicino Airport',
        navigationTarget: { address: 'Via dell’Aeroporto di Fiumicino' },
        mode: 'transit',
      },
    },
  ],
};

void test('a multi-day trip owns stops while days reference stop IDs', () => {
  assert.equal(trip.days.length, 2);
  assert.equal(
    trip.stops.find((stop) => stop.id === 'trevi')?.name,
    'Trevi Fountain',
  );
  assert.deepEqual(trip.days[1].plan, [{ stopId: 'trevi', order: 1 }]);
  assert.equal('stops' in trip.days[1], false);
});

void test('original planned day remains derivable when execution diverges', () => {
  const execution: TripExecutionState = {
    tripId: trip.id,
    executionDayId: 'day-1',
    currentStopId: 'colosseum',
    stopExecutions: {
      colosseum: {
        stopId: 'colosseum',
        status: 'pending',
        scheduledDayId: 'day-1',
      },
      trevi: {
        stopId: 'trevi',
        status: 'completed',
        scheduledDayId: 'day-2',
        completedOnDayId: 'day-1',
        completedRecordedAt: '2026-09-06T16:00:00+02:00',
      },
    },
    doNowQueue: [],
    completedDayIds: [],
    ruleAcknowledgements: [],
    lastUpdatedAt: '2026-09-06T16:00:00+02:00',
  };

  assert.equal(originalPlannedDayId(trip, 'trevi'), 'day-2');
  assert.equal(execution.stopExecutions.trevi.completedOnDayId, 'day-1');
  assert.deepEqual(trip.days[1].plan, [{ stopId: 'trevi', order: 1 }]);
});

void test('Current has one authority at trip execution level', () => {
  assert.equal(stopExecutionHasNoCurrentField, false);
  assert.equal(stopExecutionHasNoCurrentStatus, false);

  const execution: Pick<TripExecutionState, 'currentStopId'> = {
    currentStopId: 'trevi',
  };
  assert.deepEqual(execution, { currentStopId: 'trevi' });
});

void test('post-day destination remains outside sightseeing execution', () => {
  const destination: PostDayDestination = trip.days[1].postDayDestination!;
  const executionStopIds = Object.keys({
    colosseum: true,
    trevi: true,
  } satisfies Record<string, boolean>);

  assert.equal(
    trip.stops.some((stop) => stop.id === destination.id),
    false,
  );
  assert.equal(executionStopIds.includes(destination.id), false);
});

void test('unknown duration is explicit rather than a zero heuristic', () => {
  const duration: KnownOrUnknownDuration = {
    status: 'unknown',
    reason: 'unresolved',
  };

  assert.equal(duration.status, 'unknown');
  assert.equal('minutes' in duration, false);
});

void test('Do Now preserves prior scheduled-day context', () => {
  const queued: DoNowQueueEntry = {
    stopId: 'trevi',
    returnScheduledDayId: 'day-2',
  };

  assert.equal(queued.returnScheduledDayId, 'day-2');
});

void test('completed day IDs remain trip-level execution state', () => {
  const completed: Pick<TripExecutionState, 'tripId' | 'completedDayIds'> = {
    tripId: trip.id,
    completedDayIds: ['day-1'],
  };

  assert.deepEqual(completed.completedDayIds, ['day-1']);
  assert.equal('execution' in trip.days[0], false);
});
