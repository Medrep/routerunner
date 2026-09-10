import type { Trip } from './types.ts';

export type TripValidationCode =
  | 'INVALID_ID'
  | 'DUPLICATE_STOP_ID'
  | 'DUPLICATE_DAY_ID'
  | 'DUPLICATE_LEG_ID'
  | 'DUPLICATE_RULE_ID'
  | 'UNSUPPORTED_RULE'
  | 'UNKNOWN_DAY_ID'
  | 'RULE_DAY_UNAVAILABLE'
  | 'RULE_DAY_WITHOUT_HARD_END'
  | 'UNKNOWN_STOP_ID'
  | 'DUPLICATE_PLANNED_STOP'
  | 'DUPLICATE_ORDER'
  | 'INVALID_ORDER'
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_DAY_ORDER'
  | 'INVALID_TIME'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_NUMBER'
  | 'EMPTY_VISIT_PLAN'
  | 'DUPLICATE_VISIT_PLAN_ITEM_ID'
  | 'DUPLICATE_VISIT_PLAN_ITEM_ORDER'
  | 'INVALID_VISIT_PLAN_ITEM_NAME'
  | 'INVALID_VISIT_BRIEF'
  | 'INVALID_HIGHLIGHT'
  | 'TOO_MANY_HIGHLIGHTS'
  | 'INVALID_NAVIGATION_TARGET'
  | 'TOO_MANY_NAVIGATION_WAYPOINTS'
  | 'UNSUPPORTED_NAVIGATION_WAYPOINT_MODE'
  | 'POST_DAY_IDENTITY_COLLISION';

export const MAX_NAVIGATION_WAYPOINTS = 3;
export const MAX_STOP_HIGHLIGHTS = 4;

export interface TripValidationError {
  code: TripValidationCode;
  path: string;
  message: string;
}

export type TripValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: TripValidationError[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * Validates static, typed Trip data; this is not a parser for arbitrary JSON.
 * Days must be chronological with one day per date. Plan order is a unique
 * nonnegative safe integer (gaps and unsorted arrays are allowed).
 * Each stop may have at most one original plan placement, including within a day.
 * Errors follow input traversal order. No sorting, correction, or mutation occurs.
 */
export function validateTrip(trip: Trip): TripValidationResult {
  const errors: TripValidationError[] = [];
  const add = (code: TripValidationCode, path: string, message: string) => {
    errors.push({ code, path, message });
  };
  const id = (value: string, path: string) => {
    if (!value.trim()) add('INVALID_ID', path, 'Identity must not be blank.');
  };
  const uniqueIds = (
    values: { id: string }[],
    path: string,
    code: TripValidationCode,
  ) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const field = `${path}[${index}].id`;
      id(value.id, field);
      if (seen.has(value.id))
        add(code, field, `Duplicate identity "${value.id}".`);
      seen.add(value.id);
    });
    return seen;
  };
  const number = (value: number, path: string, min = 0, max = Infinity) => {
    if (!Number.isFinite(value) || value < min || value > max)
      add(
        'INVALID_NUMBER',
        path,
        `Expected a finite number between ${min} and ${max}.`,
      );
  };
  const time = (value: string | undefined, path: string) => {
    if (value !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      add('INVALID_TIME', path, 'Expected a local time in HH:mm format.');
  };
  const preparedContent = (
    value: {
      visitBrief?: string;
      highlights?: readonly string[];
    },
    path: string,
    subject: 'A Stop' | 'A visit plan item',
  ) => {
    if (
      value.visitBrief !== undefined &&
      (!value.visitBrief.trim() || value.visitBrief !== value.visitBrief.trim())
    )
      add(
        'INVALID_VISIT_BRIEF',
        `${path}.visitBrief`,
        'Visit brief must be a non-empty trimmed string.',
      );
    if (value.highlights?.length === 0)
      add(
        'INVALID_HIGHLIGHT',
        `${path}.highlights`,
        'Highlights must be omitted or contain at least one item.',
      );
    if ((value.highlights?.length ?? 0) > MAX_STOP_HIGHLIGHTS)
      add(
        'TOO_MANY_HIGHLIGHTS',
        `${path}.highlights`,
        `${subject} may contain at most ${MAX_STOP_HIGHLIGHTS} highlights.`,
      );
    value.highlights?.forEach((highlight, highlightIndex) => {
      if (!highlight.trim() || highlight !== highlight.trim())
        add(
          'INVALID_HIGHLIGHT',
          `${path}.highlights[${highlightIndex}]`,
          'Highlight must be a non-empty trimmed string.',
        );
    });
  };

  id(trip.id, 'id');
  const stopIds = uniqueIds(trip.stops, 'stops', 'DUPLICATE_STOP_ID');
  const dayIds = uniqueIds(trip.days, 'days', 'DUPLICATE_DAY_ID');
  uniqueIds(trip.legs ?? [], 'legs', 'DUPLICATE_LEG_ID');
  uniqueIds(trip.rules ?? [], 'rules', 'DUPLICATE_RULE_ID');

  // Compare raw identities too: branding alone cannot protect constructed data.
  const destinationIds = new Set<string>();
  trip.days.forEach((day, index) => {
    const destination = day.postDayDestination;
    if (!destination) return;
    destinationIds.add(destination.id);
    const path = `days[${index}].postDayDestination`;
    id(destination.id, `${path}.id`);
    if (stopIds.has(destination.id))
      add(
        'POST_DAY_IDENTITY_COLLISION',
        `${path}.id`,
        `Post-day destination "${destination.id}" also identifies a sightseeing stop.`,
      );
    const target = destination.navigationTarget;
    if ('address' in target) {
      if (!target.address.trim())
        add(
          'INVALID_NAVIGATION_TARGET',
          `${path}.navigationTarget.address`,
          'Navigation address must not be blank.',
        );
    } else {
      number(target.latitude, `${path}.navigationTarget.latitude`, -90, 90);
      number(target.longitude, `${path}.navigationTarget.longitude`, -180, 180);
    }
    time(destination.targetArrivalTime, `${path}.targetArrivalTime`);
    if (destination.plannedTravelMinutes !== undefined)
      number(destination.plannedTravelMinutes, `${path}.plannedTravelMinutes`);
  });
  const stopReference = (value: string, path: string) => {
    if (destinationIds.has(value))
      add(
        'POST_DAY_IDENTITY_COLLISION',
        path,
        `Post-day destination "${value}" cannot be used as a sightseeing reference.`,
      );
    if (!stopIds.has(value))
      add(
        'UNKNOWN_STOP_ID',
        path,
        `Stop "${value}" is absent from Trip.stops.`,
      );
  };

  for (const field of ['startDate', 'endDate'] as const) {
    if (!isDate(trip[field]))
      add(
        'INVALID_DATE',
        field,
        'Expected a valid calendar date in YYYY-MM-DD format.',
      );
  }
  if (
    isDate(trip.startDate) &&
    isDate(trip.endDate) &&
    trip.startDate > trip.endDate
  )
    add(
      'INVALID_DATE_RANGE',
      'endDate',
      'Trip endDate must be on or after startDate.',
    );
  try {
    new Intl.DateTimeFormat('en', { timeZone: trip.timeZone });
  } catch {
    add(
      'INVALID_TIME_ZONE',
      'timeZone',
      `Unknown time zone "${trip.timeZone}".`,
    );
  }

  trip.stops.forEach((stop, index) => {
    const path = `stops[${index}]`;
    preparedContent(stop, path, 'A Stop');
    if (stop.visitPlan !== undefined) {
      const itemIds = new Set<string>();
      const itemOrders = new Set<number>();
      if (stop.visitPlan.items.length === 0)
        add(
          'EMPTY_VISIT_PLAN',
          `${path}.visitPlan.items`,
          'Visit plan must be omitted or contain at least one item.',
        );
      stop.visitPlan.items.forEach((item, itemIndex) => {
        const itemPath = `${path}.visitPlan.items[${itemIndex}]`;
        id(item.id, `${itemPath}.id`);
        if (itemIds.has(item.id))
          add(
            'DUPLICATE_VISIT_PLAN_ITEM_ID',
            `${itemPath}.id`,
            `Visit plan item identity "${item.id}" is repeated within this Stop.`,
          );
        itemIds.add(item.id);
        if (!Number.isSafeInteger(item.order) || item.order < 0)
          add(
            'INVALID_ORDER',
            `${itemPath}.order`,
            'Order must be a nonnegative safe integer.',
          );
        if (itemOrders.has(item.order))
          add(
            'DUPLICATE_VISIT_PLAN_ITEM_ORDER',
            `${itemPath}.order`,
            `Order ${item.order} is repeated within this Stop's visit plan.`,
          );
        itemOrders.add(item.order);
        if (!item.name.trim() || item.name !== item.name.trim())
          add(
            'INVALID_VISIT_PLAN_ITEM_NAME',
            `${itemPath}.name`,
            'Visit plan item name must be a non-empty trimmed string.',
          );
        preparedContent(item, itemPath, 'A visit plan item');
      });
    }
    number(stop.latitude, `${path}.latitude`, -90, 90);
    number(stop.longitude, `${path}.longitude`, -180, 180);
    number(stop.plannedVisitMinutes, `${path}.plannedVisitMinutes`);
    if (stop.timeConstraint) {
      time(stop.timeConstraint.start, `${path}.timeConstraint.start`);
      time(stop.timeConstraint.end, `${path}.timeConstraint.end`);
    }
  });

  const placements = new Map<string, string>();
  const placementDayIds = new Map<string, string>();
  let previousDate: string | undefined;
  trip.days.forEach((day, index) => {
    const path = `days[${index}]`;
    if (!isDate(day.date)) {
      add(
        'INVALID_DATE',
        `${path}.date`,
        'Expected a valid calendar date in YYYY-MM-DD format.',
      );
    } else {
      if (previousDate !== undefined && day.date <= previousDate)
        add(
          'INVALID_DAY_ORDER',
          `${path}.date`,
          'Trip days must have strictly increasing dates.',
        );
      previousDate = day.date;
      if (
        isDate(trip.startDate) &&
        isDate(trip.endDate) &&
        (day.date < trip.startDate || day.date > trip.endDate)
      )
        add(
          'INVALID_DATE_RANGE',
          `${path}.date`,
          'Day date must be within the trip date range.',
        );
    }
    time(day.plannedStartTime, `${path}.plannedStartTime`);
    time(day.hardEndTime, `${path}.hardEndTime`);
    const orders = new Set<number>();
    day.plan.forEach((item, itemIndex) => {
      const itemPath = `${path}.plan[${itemIndex}]`;
      stopReference(item.stopId, `${itemPath}.stopId`);
      time(item.plannedStartTime, `${itemPath}.plannedStartTime`);
      const placement = placements.get(item.stopId);
      if (placement !== undefined)
        add(
          'DUPLICATE_PLANNED_STOP',
          `${itemPath}.stopId`,
          `Stop "${item.stopId}" already has an original placement at ${placement}.`,
        );
      else {
        placements.set(item.stopId, `${itemPath}.stopId`);
        placementDayIds.set(item.stopId, day.id);
      }
      if (!Number.isSafeInteger(item.order) || item.order < 0)
        add(
          'INVALID_ORDER',
          `${itemPath}.order`,
          'Order must be a nonnegative safe integer.',
        );
      if (orders.has(item.order))
        add(
          'DUPLICATE_ORDER',
          `${itemPath}.order`,
          `Order ${item.order} is repeated within day "${day.id}".`,
        );
      orders.add(item.order);
    });
  });

  trip.legs?.forEach((leg, index) => {
    const path = `legs[${index}]`;
    stopReference(leg.fromStopId, `${path}.fromStopId`);
    stopReference(leg.toStopId, `${path}.toStopId`);
    if (leg.plannedDurationMinutes !== undefined)
      number(leg.plannedDurationMinutes, `${path}.plannedDurationMinutes`);
    if (leg.distanceMeters !== undefined)
      number(leg.distanceMeters, `${path}.distanceMeters`);
    leg.geometry?.forEach((point, pointIndex) => {
      number(
        point.latitude,
        `${path}.geometry[${pointIndex}].latitude`,
        -90,
        90,
      );
      number(
        point.longitude,
        `${path}.geometry[${pointIndex}].longitude`,
        -180,
        180,
      );
    });
    const waypoints = leg.navigationWaypoints ?? [];
    if (waypoints.length > MAX_NAVIGATION_WAYPOINTS)
      add(
        'TOO_MANY_NAVIGATION_WAYPOINTS',
        `${path}.navigationWaypoints`,
        `A Leg may contain at most ${MAX_NAVIGATION_WAYPOINTS} navigation waypoints.`,
      );
    if (waypoints.length > 0 && leg.mode !== 'walk')
      add(
        'UNSUPPORTED_NAVIGATION_WAYPOINT_MODE',
        `${path}.navigationWaypoints`,
        `Navigation waypoints require walk mode; Google Maps does not support multi-destination public transport directions.`,
      );
    waypoints.forEach((point, pointIndex) => {
      number(
        point.latitude,
        `${path}.navigationWaypoints[${pointIndex}].latitude`,
        -90,
        90,
      );
      number(
        point.longitude,
        `${path}.navigationWaypoints[${pointIndex}].longitude`,
        -180,
        180,
      );
    });
  });
  trip.rules?.forEach((rule, index) => {
    const path = `rules[${index}]`;
    if (!isRecord(rule) || rule.type !== 'buffer_below') {
      add(
        'UNSUPPORTED_RULE',
        `${path}.type`,
        'Only buffer_below execution rules are supported.',
      );
      return;
    }
    const action = rule.action;
    if (
      !isRecord(action) ||
      action.type !== 'recommend_skip' ||
      typeof action.stopId !== 'string'
    ) {
      add(
        'UNSUPPORTED_RULE',
        `${path}.action`,
        'Only recommend_skip actions with a Stop target are supported.',
      );
      return;
    }

    stopReference(action.stopId, `${path}.action.stopId`);
    number(rule.thresholdMinutes, `${path}.thresholdMinutes`);
    if (
      rule.message !== undefined &&
      (typeof rule.message !== 'string' ||
        !rule.message.trim() ||
        rule.message !== rule.message.trim())
    ) {
      add(
        'UNSUPPORTED_RULE',
        `${path}.message`,
        'Prepared rule message must be a non-empty trimmed string.',
      );
    }

    const explicitDayId = rule.dayId;
    if (explicitDayId !== undefined && !dayIds.has(explicitDayId)) {
      add(
        'UNKNOWN_DAY_ID',
        `${path}.dayId`,
        `Day "${String(explicitDayId)}" is absent from Trip.days.`,
      );
      return;
    }
    const ruleDayId = explicitDayId ?? placementDayIds.get(action.stopId);
    if (ruleDayId === undefined) {
      add(
        'RULE_DAY_UNAVAILABLE',
        `${path}.action.stopId`,
        'A rule without dayId requires a target with an original day placement.',
      );
      return;
    }
    const ruleDay = trip.days.find((day) => day.id === ruleDayId);
    if (ruleDay && !ruleDay.hardEndTime) {
      add(
        'RULE_DAY_WITHOUT_HARD_END',
        `${path}${explicitDayId === undefined ? '.action.stopId' : '.dayId'}`,
        `A buffer_below rule requires hardEndTime on day "${ruleDayId}".`,
      );
    }
  });

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
}
