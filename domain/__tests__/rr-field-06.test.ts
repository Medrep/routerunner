import assert from 'node:assert/strict';
import test from 'node:test';

import { stopVisitContentModel } from '../../components/routerunner/stop-visit-content.ts';
import { copenhagenTrip } from '../../data/trips/copenhagen.ts';
import {
  completeCurrentStop,
  createInitialTripExecutionState,
  createStopId,
  createStopVisitPlanItemId,
  deriveRouteMapView,
  EXECUTION_STATE_SCHEMA_VERSION,
  nextEligiblePendingStopId,
  orderedStopVisitPlanItems,
  saveExecutionState,
  startDay,
  validateTrip,
  type StopVisitPlanItem,
  type Trip,
} from '../index.ts';

const vaticanId = createStopId('vatican-museums');
const cafeId = createStopId('nearby-cafe');

function item(
  id: string,
  order: number,
  name: string,
  prepared: Pick<StopVisitPlanItem, 'visitBrief' | 'highlights'> = {},
): StopVisitPlanItem {
  return {
    id: createStopVisitPlanItemId(id),
    order,
    name,
    ...prepared,
  };
}

function vaticanItems(): StopVisitPlanItem[] {
  return [
    item('sistine-chapel', 40, 'Sistine Chapel', {
      visitBrief: 'Finish in the chapel and take time to look upward.',
      highlights: ['Michelangelo’s ceiling', 'The Last Judgment'],
    }),
    item('raphael-rooms', 30, 'Raphael Rooms', {
      visitBrief: 'Continue through the papal apartments painted by Raphael.',
    }),
    item('gallery-of-maps', 20, 'Gallery of Maps', {
      visitBrief: 'Walk through the long gallery of painted maps of Italy.',
      highlights: ['Painted regional maps', 'Decorated ceiling'],
    }),
    item('pio-clementino', 10, 'Pio-Clementino Museum', {
      visitBrief: 'Begin with the classical sculpture collection.',
    }),
  ];
}

function tripWithPlan(items: readonly StopVisitPlanItem[]): Trip {
  return {
    id: 'rome-internal-plan-contract-test',
    title: 'Rome internal plan contract test',
    city: 'Rome',
    timeZone: 'Europe/Rome',
    startDate: '2026-09-09',
    endDate: '2026-09-09',
    stops: [
      {
        id: vaticanId,
        name: 'Vatican Museums',
        visitBrief: 'Follow a focused route through the museum complex.',
        visitPlan: { items },
        latitude: 41.9065,
        longitude: 12.4536,
        priority: 'must',
        canSkip: false,
        plannedVisitMinutes: 180,
      },
      {
        id: cafeId,
        name: 'Nearby café',
        latitude: 41.907,
        longitude: 12.455,
        priority: 'normal',
        canSkip: true,
        plannedVisitMinutes: 30,
      },
    ],
    days: [
      {
        id: 'rome-day',
        date: '2026-09-09',
        plan: [
          { stopId: vaticanId, order: 10 },
          { stopId: cafeId, order: 20 },
        ],
      },
    ],
  };
}

function startedState(trip: Trip) {
  const initial = createInitialTripExecutionState(
    trip,
    '2026-09-09T08:00:00.000Z',
  );
  const started = startDay(
    trip,
    initial,
    trip.days[0].id,
    '2026-09-09T08:05:00.000Z',
  );
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error('Expected Start Day to succeed.');
  return started.state;
}

void test('Stop without visitPlan remains valid', () => {
  const trip = tripWithPlan(vaticanItems());
  delete trip.stops[0].visitPlan;

  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
  assert.equal(
    stopVisitContentModel(trip.stops[0], 'details')?.visitPlanItems,
    undefined,
  );
});

void test('one-item visitPlan is valid', () => {
  const trip = tripWithPlan([item('gallery-of-maps', 10, 'Gallery of Maps')]);

  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
});

void test('four-item Vatican-style visitPlan is valid with gapped orders', () => {
  assert.deepEqual(validateTrip(tripWithPlan(vaticanItems())), {
    valid: true,
    errors: [],
  });
});

void test('canonical item order comes from order and does not mutate reversed input', () => {
  const trip = tripWithPlan(vaticanItems());
  const rawIds = trip.stops[0].visitPlan!.items.map(({ id }) => id);

  assert.deepEqual(
    orderedStopVisitPlanItems(trip.stops[0].visitPlan!).map(
      ({ order }) => order,
    ),
    [10, 20, 30, 40],
  );
  assert.deepEqual(
    trip.stops[0].visitPlan!.items.map(({ id }) => id),
    rawIds,
  );
});

void test('duplicate visit-plan item IDs are rejected within one parent Stop', () => {
  const trip = tripWithPlan([
    item('gallery', 10, 'First gallery'),
    item('gallery', 20, 'Second gallery'),
  ]);

  assert.ok(
    validateTrip(trip).errors.some(
      ({ code, path }) =>
        code === 'DUPLICATE_VISIT_PLAN_ITEM_ID' &&
        path === 'stops[0].visitPlan.items[1].id',
    ),
  );
});

void test('duplicate visit-plan item orders are rejected', () => {
  const trip = tripWithPlan([
    item('first-gallery', 10, 'First gallery'),
    item('second-gallery', 10, 'Second gallery'),
  ]);

  assert.ok(
    validateTrip(trip).errors.some(
      ({ code, path }) =>
        code === 'DUPLICATE_VISIT_PLAN_ITEM_ORDER' &&
        path === 'stops[0].visitPlan.items[1].order',
    ),
  );
});

void test('empty visitPlan is rejected in favor of omission', () => {
  const result = validateTrip(tripWithPlan([]));

  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === 'EMPTY_VISIT_PLAN' && path === 'stops[0].visitPlan.items',
    ),
  );
});

for (const invalidName of ['', '   ', ' Gallery', 'Gallery ']) {
  void test(`invalid visit-plan item name ${JSON.stringify(invalidName)} is rejected`, () => {
    const result = validateTrip(
      tripWithPlan([item('gallery', 10, invalidName)]),
    );

    assert.ok(
      result.errors.some(
        ({ code, path }) =>
          code === 'INVALID_VISIT_PLAN_ITEM_NAME' &&
          path === 'stops[0].visitPlan.items[0].name',
      ),
    );
  });
}

void test('invalid item visitBrief uses Stop prepared-content semantics', () => {
  const result = validateTrip(
    tripWithPlan([
      item('gallery', 10, 'Gallery', { visitBrief: ' trailing ' }),
    ]),
  );

  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === 'INVALID_VISIT_BRIEF' &&
        path === 'stops[0].visitPlan.items[0].visitBrief',
    ),
  );
});

void test('invalid item highlight uses Stop prepared-content semantics', () => {
  const result = validateTrip(
    tripWithPlan([item('gallery', 10, 'Gallery', { highlights: [' valid'] })]),
  );

  assert.ok(
    result.errors.some(
      ({ code, path }) =>
        code === 'INVALID_HIGHLIGHT' &&
        path === 'stops[0].visitPlan.items[0].highlights[0]',
    ),
  );
});

void test('item highlights preserve prepared order in the Details model', () => {
  const trip = tripWithPlan([
    item('gallery', 10, 'Gallery', {
      highlights: ['First notice', 'Second notice'],
    }),
  ]);

  assert.deepEqual(
    stopVisitContentModel(trip.stops[0], 'details')?.visitPlanItems?.[0]
      .highlights,
    ['First notice', 'Second notice'],
  );
});

void test('internal items do not alter Trip.stops count or TripDay.plan', () => {
  const trip = tripWithPlan(vaticanItems());

  assert.equal(trip.stops.length, 2);
  assert.deepEqual(trip.days[0].plan, [
    { stopId: vaticanId, order: 10 },
    { stopId: cafeId, order: 20 },
  ]);
});

void test('internal items never become Current or Next', () => {
  const trip = tripWithPlan(vaticanItems());
  const state = startedState(trip);

  assert.equal(state.currentStopId, vaticanId);
  assert.equal(nextEligiblePendingStopId(trip, state), cafeId);
  assert.equal(Object.keys(state.stopExecutions).length, trip.stops.length);
  for (const planItem of vaticanItems()) {
    assert.equal(Object.hasOwn(state.stopExecutions, planItem.id), false);
  }
});

void test('internal items never become numbered map Stops', () => {
  const trip = tripWithPlan(vaticanItems());
  const mapView = deriveRouteMapView(trip, startedState(trip));

  assert.deepEqual(
    mapView.stops.map(({ stopId, itineraryPosition }) => ({
      stopId,
      itineraryPosition,
    })),
    [
      { stopId: vaticanId, itineraryPosition: 1 },
      { stopId: cafeId, itineraryPosition: 2 },
    ],
  );
});

void test('Done completes the parent Stop without internal progress requirements', () => {
  const trip = tripWithPlan(vaticanItems());
  const result = completeCurrentStop(
    trip,
    startedState(trip),
    '2026-09-09T10:00:00.000Z',
  );

  assert.equal(result.ok, true);
  if (!result.ok)
    throw new Error('Expected parent Stop completion to succeed.');
  assert.equal(result.state.stopExecutions[vaticanId].status, 'completed');
  assert.equal(result.state.currentStopId, cafeId);
  assert.deepEqual(result.state.completedDayIds, []);
});

void test('execution persistence contains no internal visit-plan data', () => {
  const trip = tripWithPlan(vaticanItems());
  let serialized = '';
  const result = saveExecutionState(
    trip,
    createInitialTripExecutionState(trip, '2026-09-09T08:00:00.000Z'),
    '2026-09-09T08:00:00.000Z',
    {
      getItem: () => null,
      setItem: (_key, value) => {
        serialized = value;
      },
      removeItem: () => {},
    },
  );

  assert.equal(result.status, 'saved');
  assert.equal(EXECUTION_STATE_SCHEMA_VERSION, 3);
  assert.equal(serialized.includes('visitPlan'), false);
  assert.equal(serialized.includes('gallery-of-maps'), false);
});

void test('generic IKEA internal plan validates without tourism assumptions', () => {
  const trip = tripWithPlan([
    item('showroom', 10, 'Showroom'),
    item('lighting', 20, 'Lighting section'),
    item('warehouse-23', 30, 'Warehouse aisle 23'),
    item('checkout', 40, 'Checkout'),
  ]);
  trip.stops[0].name = 'IKEA';

  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
});

void test('the same item ID is legal under a different parent Stop', () => {
  const trip = tripWithPlan([item('checkout', 10, 'Museum shop checkout')]);
  trip.stops[1].visitPlan = {
    items: [item('checkout', 10, 'Café checkout')],
  };

  assert.deepEqual(validateTrip(trip), { valid: true, errors: [] });
});

void test('existing Copenhagen Trip remains valid and unchanged by the contract', () => {
  assert.equal(copenhagenTrip.stops.length, 16);
  assert.ok(copenhagenTrip.stops.every((stop) => stop.visitPlan === undefined));
  assert.deepEqual(validateTrip(copenhagenTrip), { valid: true, errors: [] });
});

void test('validation, ordering, and presentation do not mutate input objects', () => {
  const trip = tripWithPlan(vaticanItems());
  const before = JSON.stringify(trip);

  validateTrip(trip);
  orderedStopVisitPlanItems(trip.stops[0].visitPlan!);
  stopVisitContentModel(trip.stops[0], 'current');
  stopVisitContentModel(trip.stops[0], 'details');

  assert.equal(JSON.stringify(trip), before);
});

void test('Stop Details model exposes canonical internal content only', () => {
  const stop = tripWithPlan(vaticanItems()).stops[0];
  const details = stopVisitContentModel(stop, 'details');

  assert.deepEqual(
    details?.visitPlanItems?.map(({ order, name }) => ({ order, name })),
    [
      { order: 10, name: 'Pio-Clementino Museum' },
      { order: 20, name: 'Gallery of Maps' },
      { order: 30, name: 'Raphael Rooms' },
      { order: 40, name: 'Sistine Chapel' },
    ],
  );
  assert.equal(details?.visitPlanItemCount, undefined);
});

void test('Current model keeps the internal plan compact', () => {
  const current = stopVisitContentModel(
    tripWithPlan(vaticanItems()).stops[0],
    'current',
  );

  assert.equal(current?.visitPlanItemCount, 4);
  assert.equal(current?.visitPlanItems, undefined);
  assert.equal(
    current?.visitBrief,
    'Follow a focused route through the museum complex.',
  );
});
