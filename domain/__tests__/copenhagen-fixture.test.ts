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
  'copenhagen-gefion-fountain',
  'copenhagen-kastellet',
  'copenhagen-little-mermaid',
  'copenhagen-reffen',
  'copenhagen-christianshavn',
  'copenhagen-christiania',
  'copenhagen-black-diamond',
  'copenhagen-christiansborg',
  'copenhagen-christiansborg-tower',
  'copenhagen-stroget-old-centre',
  'copenhagen-round-tower-exterior',
  'copenhagen-rosenborg-kings-garden',
  'copenhagen-torvehallerne',
];

void test('canonical Copenhagen production fixture passes validation', () => {
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
});

void test('Copenhagen contains exactly the 16 final sightseeing identities', () => {
  assert.deepEqual(
    copenhagenTrip.stops.map((stop) => stop.id),
    expectedIds,
  );
  assert.equal(new Set(copenhagenTrip.stops.map((stop) => stop.id)).size, 16);
  assert.deepEqual(
    copenhagenTrip.stops.map((stop) => stop.name),
    [
      'Nyhavn',
      'Amalienborg',
      "Marmorkirken / Frederik's Church",
      'Gefion Fountain',
      'Kastellet',
      'Little Mermaid',
      'Refshaleøen / Reffen',
      'Christianshavn',
      'Christiania',
      'Black Diamond',
      'Christiansborg exterior',
      'Christiansborg Tower',
      'Strøget / Old Centre',
      'Round Tower exterior',
      "Rosenborg + King's Garden",
      'Torvehallerne',
    ],
  );
});

void test('all sightseeing stops remain skippable while only Reffen is planning-optional', () => {
  assert.ok(copenhagenTrip.stops.every((stop) => stop.canSkip === true));
  assert.deepEqual(
    copenhagenTrip.stops
      .filter((stop) => stop.priority === 'optional')
      .map((stop) => stop.id),
    [copenhagenStopIds.reffen],
  );
});

void test('Copenhagen has the field date, timezone, city start and hard cutoff', () => {
  assert.equal(copenhagenTrip.timeZone, 'Europe/Copenhagen');
  assert.equal(copenhagenTrip.startDate, '2026-09-08');
  assert.equal(copenhagenTrip.endDate, '2026-09-08');
  assert.equal(copenhagenTrip.days.length, 1);
  const day = copenhagenTrip.days[0];
  assert.equal(day.id, 'copenhagen-day-1');
  assert.equal(day.date, '2026-09-08');
  assert.equal(day.plannedStartTime, '10:30');
  assert.equal(day.hardEndTime, '18:30');
});

void test('day plan uses authoritative orders 10 through 160', () => {
  const day = copenhagenTrip.days[0];
  assert.deepEqual(
    day.plan.map((item) => item.order),
    Array.from({ length: 16 }, (_, index) => (index + 1) * 10),
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
  assert.equal(day.plan[0].stopId, copenhagenStopIds.nyhavn);
  assert.equal(day.plan.at(-1)?.stopId, copenhagenStopIds.torvehallerne);
  assert.equal('stops' in day, false);
  assert.equal('stopExecutions' in day, false);
  assert.equal('currentStopId' in copenhagenTrip, false);
});

void test('field intentions use only existing notes and time constraints', () => {
  const stop = (
    id: (typeof copenhagenStopIds)[keyof typeof copenhagenStopIds],
  ) => copenhagenTrip.stops.find((candidate) => candidate.id === id)!;

  assert.match(stop(copenhagenStopIds.amalienborg).note!, /no museum/i);
  assert.match(stop(copenhagenStopIds.amalienborg).note!, /guard-change/i);
  assert.equal(stop(copenhagenStopIds.amalienborg).timeConstraint, undefined);
  assert.deepEqual(stop(copenhagenStopIds.marbleChurch).timeConstraint, {
    type: 'time_window',
    start: '10:00',
    end: '17:00',
  });
  assert.deepEqual(stop(copenhagenStopIds.christiansborgTower).timeConstraint, {
    type: 'time_window',
    start: '11:00',
    end: '21:00',
  });
  assert.deepEqual(stop(copenhagenStopIds.torvehallerne).timeConstraint, {
    type: 'time_window',
    start: '10:00',
    end: '19:00',
  });
  assert.ok(
    copenhagenTrip.stops.every(
      (candidate) => !/bicycle|reserve|free time/i.test(candidate.name),
    ),
  );
});

void test('Copenhagen Airport remains distinct post-day navigation data', () => {
  assert.equal(copenhagenTrip.days[0].postDayDestination, copenhagenAirport);
  assert.deepEqual(copenhagenAirport, {
    id: 'copenhagen-airport',
    name: 'Copenhagen Airport (CPH)',
    navigationTarget: { address: 'Copenhagen Airport' },
    targetArrivalTime: '19:00',
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

void test('Reffen has the sole data-only recommendation at buffer below 30', () => {
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

void test('prepared legs connect the final route and preserve the Reffen bypass', () => {
  const endpoints = copenhagenTrip.legs!.map((leg) => [
    leg.fromStopId,
    leg.toStopId,
  ]);
  const adjacent = expectedIds
    .slice(0, -1)
    .map((from, index) => [from, expectedIds[index + 1]]);
  assert.deepEqual(
    endpoints.filter(
      ([from, to]) =>
        !(
          from === copenhagenStopIds.littleMermaid &&
          to === copenhagenStopIds.christianshavn
        ),
    ),
    adjacent,
  );
  assert.ok(
    endpoints.some(
      ([from, to]) =>
        from === copenhagenStopIds.littleMermaid &&
        to === copenhagenStopIds.christianshavn,
    ),
  );
  assert.deepEqual(
    copenhagenTrip
      .legs!.filter((leg) => leg.mode === 'ferry')
      .map((leg) => [leg.fromStopId, leg.toStopId]),
    [
      [copenhagenStopIds.littleMermaid, copenhagenStopIds.reffen],
      [copenhagenStopIds.reffen, copenhagenStopIds.christianshavn],
    ],
  );
  assert.ok(copenhagenTrip.legs!.every((leg) => leg.geometry === undefined));
});

void test('all final coordinates are valid and plausibly within central Copenhagen', () => {
  for (const stop of copenhagenTrip.stops) {
    assert.ok(stop.latitude >= 55.67 && stop.latitude <= 55.7, stop.name);
    assert.ok(stop.longitude >= 12.56 && stop.longitude <= 12.62, stop.name);
  }
  const reffen = copenhagenTrip.stops.find(
    (stop) => stop.id === copenhagenStopIds.reffen,
  )!;
  const torvehallerne = copenhagenTrip.stops.find(
    (stop) => stop.id === copenhagenStopIds.torvehallerne,
  )!;
  assert.equal(
    reffen.longitude,
    Math.max(...copenhagenTrip.stops.map((stop) => stop.longitude)),
  );
  assert.equal(
    torvehallerne.longitude,
    Math.min(...copenhagenTrip.stops.map((stop) => stop.longitude)),
  );
});
