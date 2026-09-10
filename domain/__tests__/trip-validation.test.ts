import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPostDayDestinationId,
  createStopId,
  originalPlannedDayId,
  validateTrip,
} from '../index.ts';
import type { Trip, TripValidationCode } from '../index.ts';

const firstId = createStopId('first');
const secondId = createStopId('second');
const unknownId = createStopId('unknown');
const airportId = createPostDayDestinationId('airport');

/** Synthetic contract data, not a production city itinerary. */
function validTrip(): Trip {
  return {
    id: 'validation-example',
    title: 'Validation example',
    timeZone: 'Europe/Copenhagen',
    startDate: '2026-09-06',
    endDate: '2026-09-07',
    stops: [firstId, secondId].map((id) => ({
      id,
      name: id,
      latitude: 55,
      longitude: 12,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
    })),
    days: [
      {
        id: 'first-day',
        date: '2026-09-06',
        plan: [{ stopId: firstId, order: 0 }],
      },
      {
        id: 'second-day',
        date: '2026-09-07',
        hardEndTime: '18:00',
        plan: [{ stopId: secondId, order: 0 }],
        postDayDestination: {
          id: airportId,
          name: 'Example airport',
          navigationTarget: { address: 'Example airport' },
          mode: 'transit',
        },
      },
    ],
    legs: [
      {
        id: 'first-second',
        fromStopId: firstId,
        toStopId: secondId,
        mode: 'walk',
      },
    ],
    rules: [
      {
        id: 'example-rule',
        type: 'buffer_below',
        thresholdMinutes: 20,
        action: { type: 'recommend_skip', stopId: secondId },
      },
    ],
  };
}

void test('valid multi-day data preserves unique original placement and unknown leg duration', () => {
  const trip = validTrip();
  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
  assert.equal(originalPlannedDayId(trip, firstId), 'first-day');
  assert.equal(originalPlannedDayId(trip, secondId), 'second-day');
  assert.equal('plannedDurationMinutes' in trip.legs![0], false);
});

const defects: {
  name: string;
  change: (trip: Trip) => void;
  code: TripValidationCode;
  path: string;
}[] = [
  {
    name: 'duplicate Stop IDs',
    change: (t) => {
      t.stops.push({ ...t.stops[0] });
    },
    code: 'DUPLICATE_STOP_ID',
    path: 'stops[2].id',
  },
  {
    name: 'duplicate TripDay IDs',
    change: (t) => {
      t.days[1].id = t.days[0].id;
    },
    code: 'DUPLICATE_DAY_ID',
    path: 'days[1].id',
  },
  {
    name: 'unknown planned stop',
    change: (t) => {
      t.days[0].plan[0].stopId = unknownId;
    },
    code: 'UNKNOWN_STOP_ID',
    path: 'days[0].plan[0].stopId',
  },
  {
    name: 'duplicate same-day order',
    change: (t) => {
      t.days[0].plan.push(t.days[1].plan.pop()!);
    },
    code: 'DUPLICATE_ORDER',
    path: 'days[0].plan[1].order',
  },
  {
    name: 'duplicate cross-day original placement',
    change: (t) => {
      t.days[1].plan.push({ stopId: firstId, order: 1 });
    },
    code: 'DUPLICATE_PLANNED_STOP',
    path: 'days[1].plan[1].stopId',
  },
  {
    name: 'duplicate same-day placement with distinct orders',
    change: (t) => {
      t.days[0].plan.push({ stopId: firstId, order: 1 });
    },
    code: 'DUPLICATE_PLANNED_STOP',
    path: 'days[0].plan[1].stopId',
  },
  {
    name: 'unknown leg source',
    change: (t) => {
      t.legs![0].fromStopId = unknownId;
    },
    code: 'UNKNOWN_STOP_ID',
    path: 'legs[0].fromStopId',
  },
  {
    name: 'unknown leg destination',
    change: (t) => {
      t.legs![0].toStopId = unknownId;
    },
    code: 'UNKNOWN_STOP_ID',
    path: 'legs[0].toStopId',
  },
  {
    name: 'unknown rule target',
    change: (t) => {
      t.rules![0].action.stopId = unknownId;
    },
    code: 'UNKNOWN_STOP_ID',
    path: 'rules[0].action.stopId',
  },
  {
    name: 'duplicate leg IDs',
    change: (t) => {
      t.legs!.push({ ...t.legs![0] });
    },
    code: 'DUPLICATE_LEG_ID',
    path: 'legs[1].id',
  },
  {
    name: 'duplicate rule IDs',
    change: (t) => {
      t.rules!.push({ ...t.rules![0] });
    },
    code: 'DUPLICATE_RULE_ID',
    path: 'rules[1].id',
  },
  {
    name: 'blank trip identity',
    change: (t) => {
      t.id = ' ';
    },
    code: 'INVALID_ID',
    path: 'id',
  },
  {
    name: 'reversed days',
    change: (t) => {
      t.days.reverse();
    },
    code: 'INVALID_DAY_ORDER',
    path: 'days[1].date',
  },
  {
    name: 'two days on the same date',
    change: (t) => {
      t.days[1].date = t.days[0].date;
    },
    code: 'INVALID_DAY_ORDER',
    path: 'days[1].date',
  },
  {
    name: 'invalid calendar date',
    change: (t) => {
      t.days[0].date = '2026-02-30';
    },
    code: 'INVALID_DATE',
    path: 'days[0].date',
  },
  {
    name: 'day outside trip range',
    change: (t) => {
      t.days[1].date = '2026-09-08';
    },
    code: 'INVALID_DATE_RANGE',
    path: 'days[1].date',
  },
  {
    name: 'reversed trip date range',
    change: (t) => {
      t.endDate = '2026-09-05';
    },
    code: 'INVALID_DATE_RANGE',
    path: 'endDate',
  },
  {
    name: 'invalid trip date',
    change: (t) => {
      t.startDate = 'not-a-date';
    },
    code: 'INVALID_DATE',
    path: 'startDate',
  },
  {
    name: 'unknown time zone',
    change: (t) => {
      t.timeZone = 'Unknown/Zone';
    },
    code: 'INVALID_TIME_ZONE',
    path: 'timeZone',
  },
  {
    name: 'invalid deadline',
    change: (t) => {
      t.days[0].hardEndTime = '25:00';
    },
    code: 'INVALID_TIME',
    path: 'days[0].hardEndTime',
  },
  {
    name: 'negative visit duration',
    change: (t) => {
      t.stops[0].plannedVisitMinutes = -1;
    },
    code: 'INVALID_NUMBER',
    path: 'stops[0].plannedVisitMinutes',
  },
  {
    name: 'nonfinite leg duration',
    change: (t) => {
      t.legs![0].plannedDurationMinutes = Infinity;
    },
    code: 'INVALID_NUMBER',
    path: 'legs[0].plannedDurationMinutes',
  },
  {
    name: 'invalid coordinates',
    change: (t) => {
      t.stops[0].latitude = 91;
    },
    code: 'INVALID_NUMBER',
    path: 'stops[0].latitude',
  },
  {
    name: 'invalid rule threshold',
    change: (t) => {
      t.rules![0].thresholdMinutes = NaN;
    },
    code: 'INVALID_NUMBER',
    path: 'rules[0].thresholdMinutes',
  },
  {
    name: 'airport raw identity reused by sightseeing stop',
    change: (t) => {
      t.days[1].postDayDestination!.id = createPostDayDestinationId(firstId);
    },
    code: 'POST_DAY_IDENTITY_COLLISION',
    path: 'days[1].postDayDestination.id',
  },
  {
    name: 'airport in sightseeing plan',
    change: (t) => {
      t.days[0].plan[0].stopId = createStopId(airportId);
    },
    code: 'POST_DAY_IDENTITY_COLLISION',
    path: 'days[0].plan[0].stopId',
  },
  {
    name: 'airport in sightseeing leg',
    change: (t) => {
      t.legs![0].toStopId = createStopId(airportId);
    },
    code: 'POST_DAY_IDENTITY_COLLISION',
    path: 'legs[0].toStopId',
  },
  {
    name: 'airport in skip rule',
    change: (t) => {
      t.rules![0].action.stopId = createStopId(airportId);
    },
    code: 'POST_DAY_IDENTITY_COLLISION',
    path: 'rules[0].action.stopId',
  },
  {
    name: 'empty post-day navigation target',
    change: (t) => {
      t.days[1].postDayDestination!.navigationTarget = { address: '' };
    },
    code: 'INVALID_NAVIGATION_TARGET',
    path: 'days[1].postDayDestination.navigationTarget.address',
  },
];

for (const defect of defects) {
  void test(`rejects ${defect.name} without mutating input`, () => {
    const trip = validTrip();
    defect.change(trip);
    const before = structuredClone(trip);
    const result = validateTrip(trip);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        ({ code, path }) => code === defect.code && path === defect.path,
      ),
      JSON.stringify(result.errors),
    );
    assert.deepEqual(trip, before);
    assert.deepEqual(validateTrip(trip), result);
  });
}

for (const order of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  void test(`rejects non-deterministic order ${order}`, () => {
    const trip = validTrip();
    trip.days[0].plan[0].order = order;
    assert.ok(
      validateTrip(trip).errors.some((error) => error.code === 'INVALID_ORDER'),
    );
  });
}

void test('unique sparse order values define order independently of plan array position', () => {
  const trip = validTrip();
  delete trip.rules;
  trip.days[0].plan = [
    { stopId: secondId, order: 20 },
    { stopId: firstId, order: 10 },
  ];
  trip.days[1].plan = [];
  assert.equal(validateTrip(trip).valid, true);
  assert.deepEqual(
    [...trip.days[0].plan]
      .sort((a, b) => a.order - b.order)
      .map((item) => item.stopId),
    [firstId, secondId],
  );
});

void test('validation supports omitted optional data and unplanned stops', () => {
  const trip = validTrip();
  delete trip.legs;
  delete trip.rules;
  delete trip.days[1].postDayDestination;
  trip.days[1].plan = [];
  assert.equal(validateTrip(trip).valid, true);
  assert.equal(originalPlannedDayId(trip, secondId), null);
});

void test('duplicate placement error identifies the original reference', () => {
  const trip = validTrip();
  trip.days[1].plan.push({ stopId: firstId, order: 1 });
  assert.deepEqual(validateTrip(trip), {
    valid: false,
    errors: [
      {
        code: 'DUPLICATE_PLANNED_STOP',
        path: 'days[1].plan[1].stopId',
        message:
          'Stop "first" already has an original placement at days[0].plan[0].stopId.',
      },
    ],
  });
});

void test('buffer rules reject unknown day scope and days without hard end', () => {
  const unknownDay = validTrip();
  unknownDay.rules![0].dayId = 'missing-day';
  assert.ok(
    validateTrip(unknownDay).errors.some(
      ({ code, path }) =>
        code === 'UNKNOWN_DAY_ID' && path === 'rules[0].dayId',
    ),
  );

  const noDeadline = validTrip();
  delete noDeadline.days[1].hardEndTime;
  assert.ok(
    validateTrip(noDeadline).errors.some(
      ({ code }) => code === 'RULE_DAY_WITHOUT_HARD_END',
    ),
  );
});

void test('runtime rule validation rejects unsupported rule and action shapes', () => {
  const unsupportedType = validTrip() as unknown as {
    rules: Array<Record<string, unknown>>;
  };
  unsupportedType.rules[0].type = 'replan';
  assert.ok(
    validateTrip(unsupportedType as unknown as Trip).errors.some(
      ({ code, path }) =>
        code === 'UNSUPPORTED_RULE' && path === 'rules[0].type',
    ),
  );

  const unsupportedAction = validTrip() as unknown as {
    rules: Array<Record<string, unknown>>;
  };
  unsupportedAction.rules[0].action = { type: 'save_for_later' };
  assert.ok(
    validateTrip(unsupportedAction as unknown as Trip).errors.some(
      ({ code, path }) =>
        code === 'UNSUPPORTED_RULE' && path === 'rules[0].action',
    ),
  );
});
