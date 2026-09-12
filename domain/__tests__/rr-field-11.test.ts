import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  krakowField06Trip,
  krakowMitVisitPlanItemIds,
} from '../../data/trips/krakow.ts';
import {
  romeDayIds,
  romeFiumicinoAirport,
  romeStopIds,
  romeTrip,
} from '../../data/trips/rome.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  deriveRouteMapView,
  deriveWholeTripMapView,
  EXECUTION_STATE_SCHEMA_VERSION,
  markAlreadyVisited,
  skipCurrentStop,
  startDay,
} from '../index.ts';
import type {
  StopId,
  TransitionResult,
  Trip,
  TripExecutionState,
  WholeTripPostDayMarkerView,
  WholeTripStopMarkerView,
} from '../index.ts';

const initializedAt = '2026-09-16T06:55:00.000Z';

function accepted(result: TransitionResult): TripExecutionState {
  assert.equal(result.ok, true);
  return result.state;
}

function initialState(trip: Trip): TripExecutionState {
  return createInitialTripExecutionState(trip, initializedAt);
}

function startedRome(): TripExecutionState {
  return accepted(
    startDay(
      romeTrip,
      initialState(romeTrip),
      romeDayIds.day1,
      '2026-09-16T07:00:00.000Z',
    ),
  );
}

function stopMarkers(
  view: ReturnType<typeof deriveWholeTripMapView>,
): WholeTripStopMarkerView[] {
  return view.markers.filter(
    (marker): marker is WholeTripStopMarkerView => marker.kind === 'stop',
  );
}

function postDayMarkers(
  view: ReturnType<typeof deriveWholeTripMapView>,
): WholeTripPostDayMarkerView[] {
  return view.markers.filter(
    (marker): marker is WholeTripPostDayMarkerView =>
      marker.kind === 'post-day',
  );
}

function markerFor(
  view: ReturnType<typeof deriveWholeTripMapView>,
  stopId: StopId,
): WholeTripStopMarkerView {
  const marker = stopMarkers(view).find(
    (candidate) => candidate.stopId === stopId,
  );
  assert.ok(marker);
  return marker;
}

void test('Rome whole-trip read model keeps both planned days and day-local labels', () => {
  const view = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  assert.deepEqual(
    view.days.map(({ dayId, dayNumber }) => ({ dayId, dayNumber })),
    [
      { dayId: romeDayIds.day1, dayNumber: 1 },
      { dayId: romeDayIds.day2, dayNumber: 2 },
    ],
  );

  const day1Sightseeing = stopMarkers(view).filter(
    (marker) =>
      marker.dayId === romeDayIds.day1 && marker.markerRole === 'sightseeing',
  );
  const day2Sightseeing = stopMarkers(view).filter(
    (marker) =>
      marker.dayId === romeDayIds.day2 && marker.markerRole === 'sightseeing',
  );
  assert.deepEqual(
    day1Sightseeing.map(({ markerLabel }) => markerLabel),
    Array.from({ length: 8 }, (_, index) => `D1-${index + 1}`),
  );
  assert.deepEqual(
    day2Sightseeing.map(({ markerLabel }) => markerLabel),
    Array.from({ length: 9 }, (_, index) => `D2-${index + 1}`),
  );
  assert.equal(
    stopMarkers(view).some(({ markerLabel }) => /^\d+$/.test(markerLabel)),
    false,
  );
});

void test('Rome logistics and post-day markers never consume sightseeing numbers', () => {
  const view = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  const cia = markerFor(view, romeStopIds.ciampinoAirport);
  const accommodation = markerFor(view, romeStopIds.laCasaDiElena);
  const fco = postDayMarkers(view)[0];

  assert.deepEqual(
    [
      cia.markerLabel,
      cia.markerRole,
      cia.sightseeingPosition,
      accommodation.markerLabel,
      accommodation.markerRole,
      accommodation.sightseeingPosition,
    ],
    ['START', 'logistics-start', undefined, 'END', 'logistics-end', undefined],
  );
  assert.ok(fco);
  assert.equal(fco.destinationId, romeFiumicinoAirport.id);
  assert.equal(fco.markerLabel, 'AFTER');
  assert.equal(fco.markerRole, 'post-day');
  assert.equal('stopId' in fco, false);
  assert.equal('sightseeingPosition' in fco, false);
});

void test('whole-trip derivation leaves original DayPlanItem order untouched', () => {
  const trip = structuredClone(romeTrip);
  const before = trip.days.map((day) => day.plan.map((item) => item.order));
  deriveWholeTripMapView(trip, initialState(trip));
  assert.deepEqual(
    trip.days.map((day) => day.plan.map((item) => item.order)),
    before,
  );
  assert.deepEqual(before, [
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    [10, 20, 30, 40, 50, 60, 70, 80, 90],
  ]);
});

void test('day styles are deterministic, shared within a day, and distinct across Rome days', () => {
  const first = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  const second = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  assert.notEqual(first.days[0].style.key, first.days[1].style.key);
  assert.deepEqual(
    first.days.map(({ style }) => style),
    second.days.map(({ style }) => style),
  );
  for (const day of first.days) {
    assert.equal(
      first.markers
        .filter((marker) => marker.dayId === day.dayId)
        .every((marker) => marker.dayStyle.key === day.style.key),
      true,
    );
    assert.equal(
      first.routeGroups.find((group) => group.dayId === day.dayId)?.dayStyle
        .key,
      day.style.key,
    );
  }
});

void test('Rome prepared routes remain separate by day with no invented cross-day leg', () => {
  const view = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  assert.deepEqual(
    view.routeGroups.map(({ dayId, legs }) => ({
      dayId,
      legIds: legs.map(({ legId }) => legId),
    })),
    [
      {
        dayId: romeDayIds.day1,
        legIds: Array.from(
          { length: 9 },
          (_, index) => `rome-leg-d1-${String(index + 1).padStart(2, '0')}`,
        ),
      },
      {
        dayId: romeDayIds.day2,
        legIds: Array.from(
          { length: 8 },
          (_, index) => `rome-leg-d2-${String(index + 2).padStart(2, '0')}`,
        ),
      },
    ],
  );
  assert.equal(
    view.routeGroups.some(({ legs }) =>
      legs.some(
        (leg) =>
          leg.fromStopId === romeStopIds.laCasaDiElena &&
          leg.toStopId === romeStopIds.stPetersBasilica,
      ),
    ),
    false,
  );
});

void test('prepared navigation waypoint order shapes routes without creating markers', () => {
  const view = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  const day1FinalLeg = view.routeGroups[0].legs.at(-1);
  const ponteLegs = view.routeGroups[1].legs.slice(-2);
  assert.deepEqual(day1FinalLeg?.navigationViaPoints, [
    [12.487, 41.893327],
    [12.4922, 41.8902],
    [12.491, 41.894825],
  ]);
  assert.deepEqual(day1FinalLeg?.coordinates.slice(1, -1), [
    [12.487, 41.893327],
    [12.4922, 41.8902],
    [12.491, 41.894825],
  ]);
  assert.deepEqual(
    ponteLegs.map(({ navigationViaPoints }) => navigationViaPoints),
    [[[12.479663, 41.890342]], [[12.477303, 41.890237]]],
  );
  assert.equal(
    view.markers.some(
      (marker) => marker.latitude === 41.894825 && marker.longitude === 12.491,
    ),
    false,
  );
  assert.equal(stopMarkers(view).length, romeTrip.stops.length);
});

void test('status decoration preserves original day identity and number', () => {
  const started = startedRome();
  const earlyCompleted = accepted(
    markAlreadyVisited(
      romeTrip,
      started,
      romeStopIds.trastevere,
      '2026-09-16T07:01:00.000Z',
    ),
  );
  const earlyMarker = markerFor(
    deriveWholeTripMapView(romeTrip, earlyCompleted),
    romeStopIds.trastevere,
  );
  assert.deepEqual(
    [earlyMarker.dayId, earlyMarker.markerLabel, earlyMarker.status],
    [romeDayIds.day2, 'D2-9', 'completed'],
  );

  const afterStart = accepted(
    completeCurrentStop(romeTrip, started, '2026-09-16T07:02:00.000Z'),
  );
  const afterSkip = accepted(
    skipCurrentStop(romeTrip, afterStart, '2026-09-16T07:03:00.000Z'),
  );
  const skippedMarker = markerFor(
    deriveWholeTripMapView(romeTrip, afterSkip),
    romeStopIds.spanishSteps,
  );
  assert.deepEqual(
    [skippedMarker.dayId, skippedMarker.markerLabel, skippedMarker.status],
    [romeDayIds.day1, 'D1-1', 'skipped'],
  );
});

void test('opening whole-trip map is transient UI only and exposes no execution actions', () => {
  const pageSource = readFileSync(
    new URL('../../app/page.tsx', import.meta.url),
    'utf8',
  );
  const mapSource = readFileSync(
    new URL('../../components/routerunner/whole-trip-map.tsx', import.meta.url),
    'utf8',
  );
  const openBody = pageSource.match(
    /function openWholeTripMap\(\) \{([\s\S]*?)\n  \}/,
  )?.[1];
  assert.ok(openBody);
  assert.match(openBody, /setWholeTripMapOpen\(true\)/);
  assert.doesNotMatch(
    openBody,
    /setExecution|setViewedDayId|persist|eventLog|currentStopId|executionDayId/,
  );
  assert.doesNotMatch(
    mapSource,
    /\b(?:Done|Skip|Save for later|Do now|Cancel Do Now|Already visited|Start day|End Day)\b/,
  );
  assert.match(pageSource, /> View trip map/);
  assert.doesNotMatch(
    pageSource,
    /trip\.days\.length > 1 && \(\s*<button[\s\S]*?openTripOverview/,
  );
});

void test('derivation and post-day presentation do not mutate execution or Event Log', () => {
  const state = startedRome();
  const before = structuredClone(state);
  const view = deriveWholeTripMapView(romeTrip, state);
  assert.equal(postDayMarkers(view).length, 1);
  assert.deepEqual(state, before);
  assert.deepEqual(state.eventLog, before.eventLog);
  assert.equal('viewedDayId' in state, false);
});

void test('initial bounds focus sightseeing while all points retain both Rome airports', () => {
  const view = deriveWholeTripMapView(romeTrip, initialState(romeTrip));
  const includes = (
    coordinates: typeof view.initialBoundsCoordinates,
    latitude: number,
    longitude: number,
  ) =>
    coordinates.some(
      (point) => point.latitude === latitude && point.longitude === longitude,
    );
  assert.equal(
    includes(view.initialBoundsCoordinates, 41.7999, 12.5949),
    false,
  );
  assert.equal(includes(view.initialBoundsCoordinates, 41.906, 12.4828), true);
  assert.equal(includes(view.allBoundsCoordinates, 41.7999, 12.5949), true);
  assert.equal(includes(view.allBoundsCoordinates, 41.8003, 12.2389), true);
});

void test('Copenhagen whole-trip labels differ from its unchanged normal day map', () => {
  const execution = initialState(copenhagenTrip);
  const wholeTrip = deriveWholeTripMapView(copenhagenTrip, execution);
  assert.deepEqual(
    stopMarkers(wholeTrip).map(({ markerLabel }) => markerLabel),
    Array.from({ length: 16 }, (_, index) => `D1-${index + 1}`),
  );
  assert.equal(postDayMarkers(wholeTrip).length, 0);
  assert.equal(
    wholeTrip.days[0].postDayDestinationName,
    'Copenhagen Airport (CPH)',
  );
  assert.deepEqual(
    deriveRouteMapView(copenhagenTrip, execution).stops.map(
      ({ markerLabel }) => markerLabel,
    ),
    Array.from({ length: 16 }, (_, index) => String(index + 1)),
  );
});

void test('Kraków whole-trip map exposes only five global Stops', () => {
  const view = deriveWholeTripMapView(
    krakowField06Trip,
    initialState(krakowField06Trip),
  );
  assert.equal(stopMarkers(view).length, 5);
  assert.deepEqual(
    stopMarkers(view).map(({ markerLabel }) => markerLabel),
    ['D1-1', 'D1-2', 'D1-3', 'D1-4', 'D1-5'],
  );
  const serialized = JSON.stringify(view);
  for (const visitPlanItemId of Object.values(krakowMitVisitPlanItemIds)) {
    assert.equal(serialized.includes(String(visitPlanItemId)), false);
  }
});

void test('whole-trip presentation keeps persistence schema v3', () => {
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 3);
  const state = initialState(romeTrip);
  const view = deriveWholeTripMapView(romeTrip, state);
  assert.equal('dayStyle' in state, false);
  assert.equal('markerLabel' in state, false);
  assert.equal('wholeTripMapOpen' in state, false);
  assert.equal(view.days.length, 2);
});
