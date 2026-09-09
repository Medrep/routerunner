import assert from 'node:assert/strict';
import test from 'node:test';

import { stopVisitContentModel } from '../../components/routerunner/stop-visit-content.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  createInitialTripExecutionState,
  createStopId,
  MAX_STOP_HIGHLIGHTS,
  validateTrip,
  type Stop,
  type Trip,
} from '../index.ts';

const ordinaryStops: Stop[] = [
  {
    id: createStopId('krakow-lidl'),
    name: 'Lidl',
    visitBrief: 'Buy groceries for dinner.',
    latitude: 50.0614,
    longitude: 19.9383,
    priority: 'normal',
    canSkip: true,
    plannedVisitMinutes: 15,
  },
  {
    id: createStopId('krakow-gas-station'),
    name: 'Gas station',
    visitBrief: 'Refuel the car.',
    highlights: ['Fill the tank', 'Check the receipt'],
    latitude: 50.062,
    longitude: 19.94,
    priority: 'normal',
    canSkip: false,
    plannedVisitMinutes: 10,
  },
  {
    id: createStopId('krakow-school'),
    name: 'School',
    visitBrief: 'Pick up the child.',
    latitude: 50.063,
    longitude: 19.941,
    priority: 'must',
    canSkip: false,
    plannedVisitMinutes: 5,
  },
];

function ordinaryTrip(): Trip {
  return {
    id: 'krakow-ordinary-stops-contract-test',
    title: 'Ordinary stops contract test',
    city: 'Kraków',
    timeZone: 'Europe/Warsaw',
    startDate: '2026-09-09',
    endDate: '2026-09-09',
    stops: structuredClone(ordinaryStops),
    days: [
      {
        id: 'ordinary-day',
        date: '2026-09-09',
        plan: ordinaryStops.map((stop, index) => ({
          stopId: stop.id,
          order: (index + 1) * 10,
        })),
      },
    ],
  };
}

void test('optional Stop content accepts visitBrief alone, both fields, or neither', () => {
  const trip = ordinaryTrip();
  delete trip.stops[2].visitBrief;

  assert.equal(trip.stops[0].highlights, undefined);
  assert.deepEqual(trip.stops[1].highlights, [
    'Fill the tank',
    'Check the receipt',
  ]);
  assert.equal(trip.stops[2].visitBrief, undefined);
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
});

void test('ordinary Lidl, gas station, and school briefs share the generic Stop contract', () => {
  const trip = ordinaryTrip();

  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
  assert.deepEqual(
    trip.stops.map(({ name, visitBrief }) => ({ name, visitBrief })),
    [
      { name: 'Lidl', visitBrief: 'Buy groceries for dinner.' },
      { name: 'Gas station', visitBrief: 'Refuel the car.' },
      { name: 'School', visitBrief: 'Pick up the child.' },
    ],
  );
});

for (const invalidBrief of ['', '   ', ' leading', 'trailing ']) {
  void test(`rejects invalid supplied visit brief ${JSON.stringify(invalidBrief)}`, () => {
    const trip = ordinaryTrip();
    trip.stops[0].visitBrief = invalidBrief;

    const result = validateTrip(trip);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        ({ code, path }) =>
          code === 'INVALID_VISIT_BRIEF' && path === 'stops[0].visitBrief',
      ),
    );
  });
}

for (const invalidHighlight of ['', '   ', ' leading', 'trailing ']) {
  void test(`rejects invalid supplied highlight ${JSON.stringify(invalidHighlight)}`, () => {
    const trip = ordinaryTrip();
    trip.stops[1].highlights = [invalidHighlight];

    const result = validateTrip(trip);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        ({ code, path }) =>
          code === 'INVALID_HIGHLIGHT' && path === 'stops[1].highlights[0]',
      ),
    );
  });
}

void test('rejects an empty highlight list and more than four highlights', () => {
  const empty = ordinaryTrip();
  empty.stops[1].highlights = [];
  assert.ok(
    validateTrip(empty).errors.some(
      ({ code, path }) =>
        code === 'INVALID_HIGHLIGHT' && path === 'stops[1].highlights',
    ),
  );

  const excessive = ordinaryTrip();
  excessive.stops[1].highlights = Array.from(
    { length: MAX_STOP_HIGHLIGHTS + 1 },
    (_, index) => `Highlight ${index + 1}`,
  );
  assert.ok(
    validateTrip(excessive).errors.some(
      ({ code, path }) =>
        code === 'TOO_MANY_HIGHLIGHTS' && path === 'stops[1].highlights',
    ),
  );
});

void test('Current and Details models preserve prepared copy and highlight order', () => {
  const stop = ordinaryTrip().stops[1];

  assert.deepEqual(stopVisitContentModel(stop, 'current'), {
    surface: 'current',
    visitBrief: 'Refuel the car.',
    highlights: ['Fill the tank', 'Check the receipt'],
  });
  assert.deepEqual(stopVisitContentModel(stop, 'details'), {
    surface: 'details',
    visitBrief: 'Refuel the car.',
    highlights: ['Fill the tank', 'Check the receipt'],
  });
});

void test('missing prepared content produces no Current or Details content model', () => {
  const stop = ordinaryTrip().stops[0];
  delete stop.visitBrief;

  assert.equal(stopVisitContentModel(stop, 'current'), null);
  assert.equal(stopVisitContentModel(stop, 'details'), null);
});

void test('content fields do not alter IDs, plan order, or execution state', () => {
  const withContent = ordinaryTrip();
  const withoutContent = ordinaryTrip();
  withoutContent.stops.forEach((stop) => {
    delete stop.visitBrief;
    delete stop.highlights;
  });

  assert.deepEqual(
    withContent.stops.map((stop) => stop.id),
    withoutContent.stops.map((stop) => stop.id),
  );
  assert.deepEqual(withContent.days[0].plan, withoutContent.days[0].plan);
  assert.deepEqual(
    createInitialTripExecutionState(withContent, '2026-09-09T08:00:00.000Z'),
    createInitialTripExecutionState(withoutContent, '2026-09-09T08:00:00.000Z'),
  );
});

void test('all 16 Copenhagen stops have valid concise prepared briefs', () => {
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.ok(
    copenhagenTrip.stops.every((stop) => stop.visitBrief !== undefined),
  );
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
});
