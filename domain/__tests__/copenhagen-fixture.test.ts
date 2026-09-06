import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copenhagenAirport,
  copenhagenStopIds,
  copenhagenTrip,
} from '../../data/trips/copenhagen.ts';
import { originalPlannedDayId, validateTrip } from '../index.ts';

const expectedIds = [
  'copenhagen-nyhavn',
  'copenhagen-amalienborg',
  'copenhagen-marble-church',
  'copenhagen-kastellet',
  'copenhagen-little-mermaid',
  'copenhagen-reffen',
  'copenhagen-christiania',
];

void test('canonical Copenhagen production fixture passes validation', () => {
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
});

void test('Copenhagen contains exactly the seven stable sightseeing identities', () => {
  assert.deepEqual(
    copenhagenTrip.stops.map((stop) => stop.id),
    expectedIds,
  );
  assert.equal(new Set(copenhagenTrip.stops.map((stop) => stop.id)).size, 7);
  assert.deepEqual(
    copenhagenTrip.stops.map((stop) => stop.name),
    [
      'Nyhavn',
      'Amalienborg',
      'Marble Church',
      'Kastellet',
      'Little Mermaid',
      'Reffen',
      'Christiania',
    ],
  );
});

void test('all seven stops can be skipped independently of their priority', () => {
  assert.ok(copenhagenTrip.stops.every((stop) => stop.canSkip === true));
  assert.deepEqual(
    copenhagenTrip.stops.map((stop) => stop.priority),
    ['must', 'must', 'normal', 'normal', 'must', 'optional', 'must'],
  );
  assert.deepEqual(
    copenhagenTrip.stops.map((stop) => stop.plannedVisitMinutes),
    [30, 25, 15, 20, 15, 35, 35],
  );
});

void test('Copenhagen has the resolved execution date and frozen local start and deadline', () => {
  assert.equal(copenhagenTrip.timeZone, 'Europe/Copenhagen');
  assert.equal(copenhagenTrip.startDate, '2026-09-08');
  assert.equal(copenhagenTrip.endDate, '2026-09-08');
  assert.equal(copenhagenTrip.days.length, 1);
  const day = copenhagenTrip.days[0];
  assert.equal(day.id, 'copenhagen-day-1');
  assert.equal(day.date, '2026-09-08');
  assert.equal(day.plannedStartTime, '10:00');
  assert.equal(day.hardEndTime, '18:30');
});

void test('day plan references trip-level Stops once, with deterministic original ordering', () => {
  const day = copenhagenTrip.days[0];
  assert.deepEqual(
    day.plan.map((item) => item.order),
    [1, 2, 3, 4, 5, 6, 7],
  );
  const reordered = [...day.plan].reverse().sort((a, b) => a.order - b.order);
  assert.deepEqual(
    reordered.map((item) => item.stopId),
    expectedIds,
  );
  for (const item of day.plan) {
    assert.deepEqual(Object.keys(item).sort(), ['order', 'stopId']);
    assert.equal(
      copenhagenTrip.stops.filter((stop) => stop.id === item.stopId).length,
      1,
    );
    assert.equal(originalPlannedDayId(copenhagenTrip, item.stopId), day.id);
  }
  assert.equal('stops' in day, false);
  assert.equal('stopExecutions' in day, false);
  assert.equal('currentStopId' in copenhagenTrip, false);
});

void test('Copenhagen Airport is only a post-day destination with no invented timing', () => {
  assert.equal(copenhagenTrip.days[0].postDayDestination, copenhagenAirport);
  assert.deepEqual(copenhagenAirport, {
    id: 'copenhagen-airport',
    name: 'Copenhagen Airport',
    navigationTarget: { address: 'Copenhagen Airport' },
    mode: 'transit',
  });
  const airportId = String(copenhagenAirport.id);
  assert.equal(
    copenhagenTrip.stops.some((stop) => String(stop.id) === airportId),
    false,
  );
  assert.equal(
    copenhagenTrip.days.some((day) =>
      day.plan.some((item) => String(item.stopId) === airportId),
    ),
    false,
  );
  assert.equal(
    copenhagenTrip.legs!.some(
      (leg) =>
        String(leg.fromStopId) === airportId ||
        String(leg.toStopId) === airportId,
    ),
    false,
  );
  assert.equal('stopExecutions' in copenhagenTrip, false);
});

void test('Reffen has the sole data-only skip recommendation at buffer below exactly 30', () => {
  assert.equal(copenhagenStopIds.reffen, 'copenhagen-reffen');
  assert.deepEqual(copenhagenTrip.rules, [
    {
      id: 'copenhagen-reffen-buffer-below-30',
      type: 'buffer_below',
      thresholdMinutes: 30,
      action: { type: 'recommend_skip', stopId: copenhagenStopIds.reffen },
    },
  ]);
});

void test('prepared legs preserve adjacent routes and the bounded Reffen bypass', () => {
  assert.deepEqual(
    copenhagenTrip.legs!.map((leg) => [
      leg.fromStopId,
      leg.toStopId,
      leg.mode,
      leg.plannedDurationMinutes,
    ]),
    [
      [expectedIds[0], expectedIds[1], 'walk', 12],
      [expectedIds[1], expectedIds[2], 'walk', 5],
      [expectedIds[2], expectedIds[3], 'walk', 12],
      [expectedIds[3], expectedIds[4], 'walk', 14],
      [expectedIds[4], expectedIds[5], 'ferry', 18],
      [expectedIds[5], expectedIds[6], 'transit', 19],
      [expectedIds[4], expectedIds[6], 'transit', 37],
    ],
  );
  assert.deepEqual(
    copenhagenTrip.legs!.slice(0, 4).map((leg) => leg.distanceMeters),
    [850, 350, 900, 1100],
  );
  assert.equal(copenhagenTrip.legs![4].instruction, 'Harbour Bus 992');
  assert.ok(
    copenhagenTrip
      .legs!.slice(4)
      .every((leg) => leg.distanceMeters === undefined),
  );
  assert.ok(
    copenhagenTrip.stops.every((stop) => stop.timeConstraint === undefined),
  );
});
