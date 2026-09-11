import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  copenhagenAirport,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import {
  defaultViewedDayId,
  deriveTripOverviewPresentation,
  resolveViewedDayId,
} from '../../components/routerunner/trip-overview-presentation.ts';
import {
  EXECUTION_STATE_SCHEMA_VERSION,
  activeExecutionRecommendation,
  createInitialTripExecutionState,
  createPostDayDestinationId,
  createStopId,
  deriveDayPreviewRouteMapView,
  deriveRouteMapView,
  projectSchedule,
  startDay,
  tripExecutionLifecycle,
} from '../index.ts';
import type {
  StopId,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';

const ids = {
  a: createStopId('gap04-a'),
  b: createStopId('gap04-b'),
  x: createStopId('gap04-x'),
  y: createStopId('gap04-y'),
};
const dayOneId = 'gap04-day-1';
const dayTwoId = 'gap04-day-2';
const initializedAt = '2026-09-11T07:00:00.000Z';
const startedAt = '2026-09-11T07:05:00.000Z';

function stop(id: StopId, name: string, offset: number) {
  return {
    id,
    name,
    visitBrief: `Prepared context for ${name}`,
    highlights: [`Highlight ${name}`],
    latitude: 41.89 + offset,
    longitude: 12.49 + offset,
    priority: 'normal' as const,
    canSkip: true,
    plannedVisitMinutes: 20,
  };
}

function multiDayTrip(): Trip {
  return {
    id: 'gap04-rome-like',
    title: 'Rome-like fixture',
    city: 'Rome',
    timeZone: 'Europe/Rome',
    startDate: '2026-09-11',
    endDate: '2026-09-12',
    stops: [
      stop(ids.a, 'A', 0),
      stop(ids.b, 'B', 0.01),
      stop(ids.x, 'X', 0.02),
      stop(ids.y, 'Y', 0.03),
    ],
    days: [
      {
        id: dayOneId,
        date: '2026-09-11',
        title: 'Ancient Rome',
        plan: [
          { stopId: ids.b, order: 20, plannedStartTime: '10:00' },
          { stopId: ids.a, order: 10, plannedStartTime: '09:00' },
        ],
      },
      {
        id: dayTwoId,
        date: '2026-09-12',
        title: 'Vatican and parks',
        plan: [
          { stopId: ids.y, order: 90, plannedStartTime: '14:00' },
          { stopId: ids.x, order: 30, plannedStartTime: '09:30' },
        ],
        postDayDestination: {
          id: createPostDayDestinationId('gap04-day-2-hotel'),
          name: 'Hotel',
          navigationTarget: { address: 'Rome hotel' },
        },
      },
    ],
    legs: [
      {
        id: 'gap04-a-b',
        fromStopId: ids.a,
        toStopId: ids.b,
        mode: 'walk',
        plannedDurationMinutes: 10,
      },
      {
        id: 'gap04-x-y',
        fromStopId: ids.x,
        toStopId: ids.y,
        mode: 'transit',
        plannedDurationMinutes: 18,
      },
    ],
    rules: [
      {
        id: 'gap04-day-2-rule',
        type: 'buffer_below',
        dayId: dayTwoId,
        thresholdMinutes: 30,
        action: { type: 'recommend_skip', stopId: ids.y },
      },
    ],
  };
}

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function activeDayOne(trip = multiDayTrip()): TripExecutionState {
  return accepted(
    startDay(
      trip,
      createInitialTripExecutionState(trip, initializedAt),
      dayOneId,
      startedAt,
    ),
  );
}

function preview(
  trip: Trip,
  state: TripExecutionState,
  viewedDayId = dayTwoId,
) {
  return deriveTripOverviewPresentation(trip, state, viewedDayId);
}

void test('overview contains every TripDay in canonical Trip.days order', () => {
  const trip = multiDayTrip();
  const model = preview(trip, activeDayOne(trip));

  assert.deepEqual(
    model.days.map(({ dayId, dayNumber, label }) => ({
      dayId,
      dayNumber,
      label,
    })),
    [
      { dayId: dayOneId, dayNumber: 1, label: 'Day 1' },
      { dayId: dayTwoId, dayNumber: 2, label: 'Day 2' },
    ],
  );
});

void test('active, completed, upcoming, and viewed are derived independently', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const activeModel = preview(trip, active);

  assert.equal(activeModel.days[0].lifecycleStatus, 'active');
  assert.equal(activeModel.days[0].isViewed, false);
  assert.equal(activeModel.days[1].lifecycleStatus, 'upcoming');
  assert.equal(activeModel.days[1].isViewed, true);

  const completedDayOne: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    completedDayIds: [dayOneId],
  };
  const completedModel = deriveTripOverviewPresentation(
    trip,
    completedDayOne,
    dayOneId,
  );
  assert.equal(completedModel.days[0].lifecycleStatus, 'completed');
  assert.equal(completedModel.days[0].isViewed, true);
});

void test('active zero-work is not completed and stop exhaustion does not complete an upcoming day', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const activeZeroWork: TripExecutionState = {
    ...active,
    executionDayId: dayTwoId,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    stopExecutions: {
      ...active.stopExecutions,
      [ids.x]: {
        ...active.stopExecutions[ids.x],
        status: 'completed',
        completedRecordedAt: startedAt,
        completedOnDayId: dayOneId,
      },
      [ids.y]: {
        ...active.stopExecutions[ids.y],
        status: 'completed',
        completedRecordedAt: startedAt,
        completedOnDayId: dayOneId,
      },
    },
  };
  assert.equal(preview(trip, activeZeroWork).days[1].lifecycleStatus, 'active');

  const neverStartedFuture: TripExecutionState = {
    ...activeZeroWork,
    executionDayId: dayOneId,
    currentStopId: ids.a,
    currentStepStartedAt: startedAt,
    currentInboundTravel: {
      fromStopId: null,
      toStopId: ids.a,
      duration: { status: 'known', minutes: 0 },
    },
  };
  assert.equal(
    preview(trip, neverStartedFuture).days[1].lifecycleStatus,
    'upcoming',
  );
});

void test('selecting and returning viewed days preserves all execution bytes', () => {
  const trip = multiDayTrip();
  const state = activeDayOne(trip);
  const before = JSON.stringify(state);

  const dayTwo = preview(trip, state);
  assert.equal(dayTwo.viewedDayId, dayTwoId);
  assert.equal(dayTwo.isReadOnlyPreview, true);
  assert.equal(dayTwo.executionContext?.dayId, dayOneId);
  assert.equal(dayTwo.executionContext?.currentStopId, ids.a);
  assert.equal(dayTwo.executionContext?.currentStopName, 'A');
  assert.equal(JSON.stringify(state), before);

  const dayOne = deriveTripOverviewPresentation(trip, state, dayOneId);
  assert.equal(dayOne.isReadOnlyPreview, false);
  assert.equal(state.executionDayId, dayOneId);
  assert.equal(state.currentStopId, ids.a);
  assert.equal(state.currentStepStartedAt, startedAt);
  assert.deepEqual(state.currentInboundTravel, {
    fromStopId: null,
    toStopId: ids.a,
    duration: { status: 'unknown', reason: 'unresolved' },
  });
  assert.equal(JSON.stringify(state), before);
});

void test('viewedDayId is transient, absent from state/schema, and defaults to execution then first day', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const stateKeys = Object.keys(active);

  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 2);
  assert.equal(stateKeys.includes('viewedDayId'), false);
  assert.equal(defaultViewedDayId(trip, active), dayOneId);
  assert.equal(resolveViewedDayId(trip, active, 'missing'), dayOneId);

  const ready = createInitialTripExecutionState(trip, initializedAt);
  assert.equal(defaultViewedDayId(trip, ready), dayOneId);
  assert.equal(resolveViewedDayId(trip, ready, dayTwoId), dayTwoId);
});

void test('preview uses original plan order and preserves early-completed, skipped, and For Later stops', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const historical: TripExecutionState = {
    ...active,
    stopExecutions: {
      ...active.stopExecutions,
      [ids.x]: {
        ...active.stopExecutions[ids.x],
        status: 'completed',
        completedRecordedAt: '2026-09-11T08:00:00.000Z',
        completedOnDayId: dayOneId,
      },
      [ids.y]: {
        ...active.stopExecutions[ids.y],
        scheduledDayId: null,
      },
    },
  };
  const originalPlanBefore = structuredClone(trip.days[1].plan);
  const model = preview(trip, historical).days[1];

  assert.deepEqual(
    model.stops.map(({ stopId, itineraryPosition, status }) => ({
      stopId,
      itineraryPosition,
      status,
    })),
    [
      { stopId: ids.x, itineraryPosition: 1, status: 'completed' },
      { stopId: ids.y, itineraryPosition: 2, status: 'saved' },
    ],
  );
  assert.equal(model.stops[0].completedEarly, true);
  assert.equal(model.stops[0].completedOnDayLabel, 'Day 1');
  assert.deepEqual(trip.days[1].plan, originalPlanBefore);

  const skipped: TripExecutionState = {
    ...historical,
    stopExecutions: {
      ...historical.stopExecutions,
      [ids.y]: {
        ...historical.stopExecutions[ids.y],
        status: 'skipped',
        scheduledDayId: dayTwoId,
      },
    },
  };
  assert.equal(preview(trip, skipped).days[1].stops[1].status, 'skipped');
});

void test('preview map uses viewed TripDay numbering and no execution Current/Next/inbound context', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const executionMap = deriveRouteMapView(trip, active);
  const previewMap = deriveDayPreviewRouteMapView(trip, active, dayTwoId);

  assert.deepEqual(
    executionMap.stops.map(({ stopId, status }) => ({ stopId, status })),
    [
      { stopId: ids.a, status: 'current' },
      { stopId: ids.b, status: 'next' },
    ],
  );
  assert.deepEqual(
    previewMap.stops.map(({ stopId, itineraryPosition, status }) => ({
      stopId,
      itineraryPosition,
      status,
    })),
    [
      { stopId: ids.x, itineraryPosition: 1, status: 'future' },
      { stopId: ids.y, itineraryPosition: 2, status: 'future' },
    ],
  );
  assert.deepEqual(previewMap.navigationViaPoints, []);
  assert.equal(previewMap.stops.length, trip.days[1].plan.length);
  assert.equal(
    previewMap.stops.some(({ stopId }) =>
      String(stopId).includes('day-2-hotel'),
    ),
    false,
  );
});

void test('completed and trip-complete historical views remain read-only without reopening', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const dayComplete: TripExecutionState = {
    ...active,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    completedDayIds: [dayOneId],
  };
  const beforeDayComplete = JSON.stringify(dayComplete);
  assert.deepEqual(tripExecutionLifecycle(trip, dayComplete), {
    status: 'DAY_COMPLETE',
    dayId: dayOneId,
  });
  assert.equal(preview(trip, dayComplete, dayOneId).days[0].isViewed, true);
  assert.equal(JSON.stringify(dayComplete), beforeDayComplete);

  const tripComplete: TripExecutionState = {
    ...dayComplete,
    executionDayId: dayTwoId,
    completedDayIds: [dayOneId, dayTwoId],
  };
  const beforeTripComplete = JSON.stringify(tripComplete);
  assert.equal(
    tripExecutionLifecycle(trip, tripComplete).status,
    'TRIP_COMPLETE',
  );
  const historical = preview(trip, tripComplete, dayOneId);
  assert.equal(historical.isReadOnlyPreview, true);
  assert.equal(historical.days[0].lifecycleStatus, 'completed');
  assert.equal(JSON.stringify(tripComplete), beforeTripComplete);
});

void test('viewing a future day cannot change schedule or activate its bounded rule', () => {
  const trip = multiDayTrip();
  const active = activeDayOne(trip);
  const beforeProjection = projectSchedule(trip, active, startedAt);
  const beforeRecommendation = activeExecutionRecommendation(
    trip,
    active,
    beforeProjection,
  );

  preview(trip, active, dayTwoId);

  assert.deepEqual(projectSchedule(trip, active, startedAt), beforeProjection);
  assert.deepEqual(
    activeExecutionRecommendation(trip, active, beforeProjection),
    beforeRecommendation,
  );
  assert.equal(beforeRecommendation, undefined);
});

void test('Copenhagen remains one canonical day with 16 stops and its post-day destination', () => {
  const ready = createInitialTripExecutionState(copenhagenTrip, initializedAt);
  const model = deriveTripOverviewPresentation(copenhagenTrip, ready);

  assert.equal(copenhagenTrip.days.length, 1);
  assert.equal(model.days.length, 1);
  assert.equal(model.days[0].plannedStopCount, 16);
  assert.equal(model.days[0].day.postDayDestination, copenhagenAirport);
  assert.equal(model.viewedDayId, copenhagenTrip.days[0].id);
  assert.equal(model.isReadOnlyPreview, false);
});

void test('repeated overview derivation is deterministic and mutation-free', () => {
  const trip = multiDayTrip();
  const state = activeDayOne(trip);
  const tripBefore = structuredClone(trip);
  const stateBefore = structuredClone(state);

  const first = preview(trip, state);
  const second = preview(trip, state);

  assert.deepEqual(second, first);
  assert.deepEqual(trip, tripBefore);
  assert.deepEqual(state, stateBefore);
});

void test('production navigation keeps viewed-day selection presentation-only and gates preview mutations', () => {
  const source = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  const selectionBody = source.match(
    /function viewPlannedDay\(dayId: string\) \{([\s\S]*?)\n  \}/,
  )?.[1];

  assert.ok(selectionBody);
  assert.match(selectionBody, /setViewedDayId\(dayId\)/);
  assert.match(selectionBody, /setTripSurface\('day'\)/);
  assert.doesNotMatch(selectionBody, /setExecution|persist|startDay|doNow/);
  assert.match(source, /className="overview-trigger"/);
  assert.match(source, /trip\.days\.length > 1/);
  assert.match(source, /Preview · not executing/);
  assert.match(source, /Return to execution/);
  assert.match(source, /!isReadOnlyPreview &&[\s\S]*recommendation/);
  assert.match(source, /!isReadOnlyPreview &&[\s\S]*canDoNowDetail/);
  assert.doesNotMatch(source, /localStorage/);
});
