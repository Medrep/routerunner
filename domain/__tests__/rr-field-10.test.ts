import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { dayPlanPresentationModel } from '../../components/routerunner/day-plan-presentation.ts';
import {
  deriveTripOverviewPresentation,
  resolveViewedDayId,
} from '../../components/routerunner/trip-overview-presentation.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import { krakowField06Trip } from '../../data/trips/krakow.ts';
import {
  romeDayIds,
  romeFiumicinoAirport,
  romeStopIds,
  romeTrip,
} from '../../data/trips/rome.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  currentGoogleMapsNavigationUrl,
  deriveRouteMapMarkerDetail,
  deriveRouteMapView,
  deriveStopActionModel,
  EXECUTION_STATE_SCHEMA_VERSION,
  isSightseeingStop,
  isRecommendationTargetEligible,
  startDay,
  stopKind,
  stopSemanticLabel,
  validateTrip,
} from '../index.ts';
import type {
  StopId,
  TransitionResult,
  Trip,
  TripExecutionState,
} from '../index.ts';

const initializedAt = '2026-09-16T07:00:00.000Z';

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function startedRome(): TripExecutionState {
  return accepted(
    startDay(
      romeTrip,
      createInitialTripExecutionState(romeTrip, initializedAt),
      romeDayIds.day1,
      '2026-09-16T07:01:00.000Z',
    ),
  );
}

function advanceTo(stopId: StopId): TripExecutionState {
  let state = startedRome();
  let minute = 2;
  while (state.currentStopId !== stopId) {
    state = accepted(
      completeCurrentStop(
        romeTrip,
        state,
        `2026-09-16T07:${String(minute).padStart(2, '0')}:00.000Z`,
      ),
    );
    minute += 1;
  }
  return state;
}

function stop(stopId: StopId) {
  const result = romeTrip.stops.find((candidate) => candidate.id === stopId);
  assert.ok(result);
  return result;
}

void test('omitted Stop.kind remains sightseeing across existing fixtures and presentation', () => {
  assert.equal(stopKind(copenhagenTrip.stops[0]), 'sightseeing');
  assert.equal(isSightseeingStop(copenhagenTrip.stops[0]), true);
  assert.equal(stopSemanticLabel(copenhagenTrip.stops[0]), 'Must-see');
  assert.equal(krakowField06Trip.stops.every(isSightseeingStop), true);
  assert.equal(validateTrip(copenhagenTrip).valid, true);
  assert.equal(validateTrip(krakowField06Trip).valid, true);
});

void test('logistics start and accommodation roles validate while incoherent roles reject', () => {
  for (const logisticsRole of ['start', 'accommodation'] as const) {
    const trip: Trip = structuredClone(copenhagenTrip);
    trip.stops[0] = { ...trip.stops[0], kind: 'logistics', logisticsRole };
    assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
  }

  const invalid: Trip = structuredClone(copenhagenTrip);
  invalid.stops[0] = {
    ...invalid.stops[0],
    kind: 'sightseeing',
    logisticsRole: 'accommodation',
  };
  assert.deepEqual(
    validateTrip(invalid).errors.map(({ code, path }) => ({ code, path })),
    [
      {
        code: 'INVALID_STOP_SEMANTICS',
        path: 'stops[0].logisticsRole',
      },
    ],
  );
});

void test('Rome logistics identity is static, role-based, and never exposes priority presentation', () => {
  const cia = stop(romeStopIds.ciampinoAirport);
  const accommodation = stop(romeStopIds.laCasaDiElena);
  assert.deepEqual(
    [
      cia.kind,
      cia.logisticsRole,
      cia.priority,
      cia.canSkip,
      cia.plannedVisitMinutes,
    ],
    ['logistics', 'start', 'must', false, 30],
  );
  assert.deepEqual(
    [
      accommodation.kind,
      accommodation.logisticsRole,
      accommodation.priority,
      accommodation.canSkip,
      accommodation.plannedVisitMinutes,
    ],
    ['logistics', 'accommodation', 'must', false, 10],
  );
  assert.equal(stopSemanticLabel(cia), 'Start point');
  assert.equal(stopSemanticLabel(accommodation), 'Accommodation / end');
  assert.doesNotMatch(stopSemanticLabel(cia), /Must|Normal|Optional/i);
  assert.doesNotMatch(
    stopSemanticLabel(accommodation),
    /Must|Normal|Optional/i,
  );
});

void test('Rome Day 1 keeps canonical order while logistics markers bracket sights 1 through 8', () => {
  const model = dayPlanPresentationModel(romeTrip.days[0], romeTrip.stops);
  assert.deepEqual(
    model.map(({ planItem }) => planItem.order),
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  );
  assert.deepEqual(
    model.map(({ markerLabel }) => markerLabel),
    ['START', '1', '2', '3', '4', '5', '6', '7', '8', 'END'],
  );
  assert.deepEqual(
    model.map(({ sightseeingPosition }) => sightseeingPosition),
    [undefined, 1, 2, 3, 4, 5, 6, 7, 8, undefined],
  );

  const map = deriveRouteMapView(romeTrip, startedRome());
  assert.deepEqual(
    map.stops.map(({ markerLabel }) => markerLabel),
    ['START', '1', '2', '3', '4', '5', '6', '7', '8', 'END'],
  );
  assert.equal(map.stops[0].sightseeingPosition, undefined);
  assert.equal(map.stops.at(-1)?.sightseeingPosition, undefined);
  assert.deepEqual(
    [
      map.stops[0].markerRole,
      map.stops[1].markerRole,
      map.stops.at(-1)?.markerRole,
    ],
    ['logistics-start', 'sightseeing', 'logistics-end'],
  );
  assert.equal(map.stops[0].plannedStartTime, '09:40');
});

void test('day-map markers keep compact identity and reveal read-only selected details', () => {
  const state = startedRome();
  const stateBefore = structuredClone(state);
  const tripBefore = structuredClone(romeTrip);
  const view = deriveRouteMapView(romeTrip, state);
  const spanishSteps = view.stops.find(
    ({ stopId }) => stopId === romeStopIds.spanishSteps,
  );
  assert.ok(spanishSteps);
  assert.equal(spanishSteps.markerLabel, '1');
  assert.equal(spanishSteps.markerLabel.includes(spanishSteps.name), false);

  const selected = deriveRouteMapMarkerDetail(view, spanishSteps.stopId);
  assert.equal(selected?.name, spanishSteps.name);
  assert.equal(selected?.markerLabel, '1');
  assert.equal(selected?.semanticLabel, spanishSteps.semanticLabel);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(romeTrip, tripBefore);
  assert.deepEqual(state.eventLog, stateBefore.eventLog);
});

void test('START and END use compact color-independent logistics contracts', () => {
  const view = deriveRouteMapView(romeTrip, startedRome());
  const start = view.stops[0];
  const sight = view.stops[1];
  const end = view.stops.at(-1)!;

  assert.deepEqual(
    [start.markerLabel, start.markerRole, start.sightseeingPosition],
    ['START', 'logistics-start', undefined],
  );
  assert.deepEqual(
    [end.markerLabel, end.markerRole, end.sightseeingPosition],
    ['END', 'logistics-end', undefined],
  );
  assert.notEqual(start.markerRole, sight.markerRole);
  assert.notEqual(end.markerRole, sight.markerRole);
  assert.notEqual(start.markerRole, end.markerRole);
  assert.notEqual(start.markerLabel, end.markerLabel);
});

void test('day-map initial bounds exclude distant START but retain it as a marker and keep nearby END', () => {
  const view = deriveRouteMapView(
    romeTrip,
    createInitialTripExecutionState(romeTrip, initializedAt),
  );
  const includes = (latitude: number, longitude: number) =>
    view.initialBoundsCoordinates.some(
      (point) => point.latitude === latitude && point.longitude === longitude,
    );

  assert.equal(includes(41.7999, 12.5949), false);
  assert.equal(includes(41.891373, 12.518824), true);
  assert.equal(
    view.stops.some(({ stopId }) => stopId === romeStopIds.ciampinoAirport),
    true,
  );
  assert.equal(
    view.stops.some(({ stopId }) => stopId === romeStopIds.laCasaDiElena),
    true,
  );
});

void test('map UI removes permanent names, keeps transient selection, and omits the full-map overlay', () => {
  const routeMapSource = readFileSync(
    new URL('../../components/routerunner/route-map.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  );
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(routeMapSource, /markerButton\.textContent = stop\.markerLabel/);
  assert.doesNotMatch(routeMapSource, /dataset\.label|attr\(data-label\)/);
  assert.doesNotMatch(css, /\.mapbox-stop-marker::after/);
  assert.match(routeMapSource, /setSelectedStopId\(stop\.stopId\)/);
  assert.match(routeMapSource, /<strong>\{selectedStop\.name\}<\/strong>/);
  assert.doesNotMatch(
    routeMapSource,
    /onStopRef|setDetail|setExecution|persist/,
  );
  assert.match(routeMapSource, /\{!full && !selectedStop && \(/);
  assert.match(pageSource, /displayedStop\.logisticsRole === 'start'/);
  assert.doesNotMatch(pageSource, /Start Day begins at this start point/);
  assert.match(css, /\.stop-number\.logistics-start/);
  assert.match(css, /\.stop-number\.logistics-end/);
  assert.match(pageSource, /!isSightseeingStop\(stop\) \? \(\s*markerLabel/);
});

void test('day summaries count sights separately and preserve all-sightseeing fixtures', () => {
  const rome = deriveTripOverviewPresentation(
    romeTrip,
    createInitialTripExecutionState(romeTrip, initializedAt),
  );
  assert.deepEqual(
    rome.days.map(({ sightseeingStopCount, logisticsStopCount }) => ({
      sightseeingStopCount,
      logisticsStopCount,
    })),
    [
      { sightseeingStopCount: 8, logisticsStopCount: 2 },
      { sightseeingStopCount: 9, logisticsStopCount: 0 },
    ],
  );

  const copenhagenMap = deriveRouteMapView(
    copenhagenTrip,
    createInitialTripExecutionState(copenhagenTrip, initializedAt),
  );
  assert.deepEqual(
    copenhagenMap.stops.map(({ markerLabel }) => markerLabel),
    Array.from({ length: 16 }, (_, index) => String(index + 1)),
  );
  assert.deepEqual(
    dayPlanPresentationModel(
      krakowField06Trip.days[0],
      krakowField06Trip.stops,
    ).map(({ markerLabel }) => markerLabel),
    ['1', '2', '3', '4', '5'],
  );
});

void test('logistics action eligibility is canonical-only with role-specific completion labels', () => {
  const startState = startedRome();
  const startModel = deriveStopActionModel(
    romeTrip,
    startState,
    romeStopIds.ciampinoAirport,
  );
  assert.equal(startModel?.completionLabel, 'Continue');
  assert.deepEqual(startModel?.actions, {
    navigate: false,
    done: true,
    skip: false,
    saveForLater: false,
    doNow: false,
    cancelDoNow: false,
    alreadyVisited: false,
  });

  const futureAccommodation = deriveStopActionModel(
    romeTrip,
    startState,
    romeStopIds.laCasaDiElena,
  );
  assert.deepEqual(futureAccommodation?.actions, {
    navigate: false,
    done: false,
    skip: false,
    saveForLater: false,
    doNow: false,
    cancelDoNow: false,
    alreadyVisited: false,
  });
  const permissiveLogisticsTrip: Trip = {
    ...romeTrip,
    stops: romeTrip.stops.map((candidate) =>
      candidate.id === romeStopIds.laCasaDiElena
        ? { ...candidate, canSkip: true }
        : candidate,
    ),
  };
  assert.equal(
    isRecommendationTargetEligible(
      permissiveLogisticsTrip,
      startState,
      romeStopIds.laCasaDiElena,
    ),
    false,
  );

  const accommodationState = advanceTo(romeStopIds.laCasaDiElena);
  const accommodationModel = deriveStopActionModel(
    romeTrip,
    accommodationState,
    romeStopIds.laCasaDiElena,
  );
  assert.equal(accommodationModel?.completionLabel, 'Arrived');
  assert.deepEqual(accommodationModel?.actions, {
    navigate: true,
    done: true,
    skip: false,
    saveForLater: false,
    doNow: false,
    cancelDoNow: false,
    alreadyVisited: false,
  });
});

void test('Continue and Arrived reuse canonical completion and Event Log behavior', () => {
  const continued = accepted(
    completeCurrentStop(romeTrip, startedRome(), '2026-09-16T07:02:00.000Z'),
  );
  assert.equal(continued.currentStopId, romeStopIds.spanishSteps);
  assert.deepEqual(continued.eventLog.at(-1), {
    version: 1,
    type: 'stop_completed',
    recordedAt: '2026-09-16T07:02:00.000Z',
    executionDayId: romeDayIds.day1,
    stopId: romeStopIds.ciampinoAirport,
  });

  const arrived = accepted(
    completeCurrentStop(
      romeTrip,
      advanceTo(romeStopIds.laCasaDiElena),
      '2026-09-16T07:20:00.000Z',
    ),
  );
  assert.equal(arrived.currentStopId, undefined);
  assert.deepEqual(
    arrived.eventLog.slice(-2).map(({ type }) => type),
    ['stop_completed', 'day_completed'],
  );
});

void test('corrected accommodation identity, route, and navigation are exact', () => {
  const accommodation = stop(romeStopIds.laCasaDiElena);
  assert.equal(accommodation.name, 'Accommodation — Via Prenestina 18');
  assert.equal(accommodation.shortName, 'Accommodation');
  assert.equal(accommodation.latitude, 41.891373);
  assert.equal(accommodation.longitude, 12.518824);
  assert.match(accommodation.note ?? '', /Via Prenestina, 18/);
  assert.match(accommodation.note ?? '', /00176 Roma, Italy/);

  const leg = romeTrip.legs?.find(({ id }) => id === 'rome-leg-d1-09');
  assert.equal(leg?.toStopId, romeStopIds.laCasaDiElena);
  assert.equal(leg?.plannedDurationMinutes, 55);
  assert.deepEqual(leg?.navigationWaypoints, [
    { latitude: 41.893327, longitude: 12.487 },
    { latitude: 41.8902, longitude: 12.4922 },
    { latitude: 41.894825, longitude: 12.491 },
  ]);

  const url = new URL(
    currentGoogleMapsNavigationUrl(
      romeTrip,
      advanceTo(romeStopIds.laCasaDiElena),
    )!,
  );
  assert.equal(url.searchParams.get('destination'), '41.891373,12.518824');
  assert.equal(
    url.searchParams.get('waypoints'),
    '41.893327,12.487|41.8902,12.4922|41.894825,12.491',
  );

  const fixtureSource = readFileSync(
    new URL('../../data/trips/rome.ts', import.meta.url),
    'utf8',
  );
  const legacyCoordinates = [
    ['41', '8906'].join('.'),
    ['12', '5103'].join('.'),
  ];
  for (const coordinate of legacyCoordinates) {
    assert.equal(fixtureSource.includes(coordinate), false);
  }
});

void test('all read-only day selection controls say Preview day and remain mutation-free', () => {
  const source = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(source.match(/Preview day/g)?.length, 2);
  assert.doesNotMatch(source, />\s*(?:Open day|Preview|View tomorrow)\s*</);
  const selectionBody = source.match(
    /function viewPlannedDay\(dayId: string\) \{([\s\S]*?)\n  \}/,
  )?.[1];
  assert.ok(selectionBody);
  assert.match(selectionBody, /setViewedDayId\(dayId\)/);
  assert.doesNotMatch(
    selectionBody,
    /setExecution|switchExecutionDay|persist|currentStopId|eventLog/,
  );

  const state = startedRome();
  const before = structuredClone(state);
  assert.equal(
    resolveViewedDayId(romeTrip, state, romeDayIds.day2),
    romeDayIds.day2,
  );
  assert.deepEqual(state, before);
});

void test('Day 2, FCO, state shape, and schema remain unchanged', () => {
  assert.equal(romeTrip.days[1].plan.length, 9);
  assert.equal(romeTrip.days[1].postDayDestination, romeFiumicinoAirport);
  assert.equal(
    romeTrip.stops.some(
      ({ id }) => String(id) === String(romeFiumicinoAirport.id),
    ),
    false,
  );
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 3);
  const state = startedRome();
  assert.equal('kind' in state, false);
  assert.equal('logisticsRole' in state, false);
  assert.equal(
    Object.values(state.stopExecutions).some(
      (execution) => 'kind' in execution || 'logisticsRole' in execution,
    ),
    false,
  );
  assert.equal(
    state.eventLog.some((event) => 'kind' in event || 'logisticsRole' in event),
    false,
  );
});
