import type { Trip } from './types.ts';

export type TripValidationCode =
  | 'INVALID_ID'
  | 'DUPLICATE_STOP_ID'
  | 'DUPLICATE_DAY_ID'
  | 'DUPLICATE_LEG_ID'
  | 'DUPLICATE_RULE_ID'
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
  | 'INVALID_NAVIGATION_TARGET'
  | 'POST_DAY_IDENTITY_COLLISION';

export interface TripValidationError {
  code: TripValidationCode;
  path: string;
  message: string;
}

export type TripValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: TripValidationError[] };

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

  id(trip.id, 'id');
  const stopIds = uniqueIds(trip.stops, 'stops', 'DUPLICATE_STOP_ID');
  uniqueIds(trip.days, 'days', 'DUPLICATE_DAY_ID');
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
    number(stop.latitude, `${path}.latitude`, -90, 90);
    number(stop.longitude, `${path}.longitude`, -180, 180);
    number(stop.plannedVisitMinutes, `${path}.plannedVisitMinutes`);
    if (stop.timeConstraint) {
      time(stop.timeConstraint.start, `${path}.timeConstraint.start`);
      time(stop.timeConstraint.end, `${path}.timeConstraint.end`);
    }
  });

  const placements = new Map<string, string>();
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
      const placement = placements.get(item.stopId);
      if (placement !== undefined)
        add(
          'DUPLICATE_PLANNED_STOP',
          `${itemPath}.stopId`,
          `Stop "${item.stopId}" already has an original placement at ${placement}.`,
        );
      else placements.set(item.stopId, `${itemPath}.stopId`);
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
  });
  trip.rules?.forEach((rule, index) => {
    stopReference(rule.action.stopId, `rules[${index}].action.stopId`);
    number(rule.thresholdMinutes, `rules[${index}].thresholdMinutes`);
  });

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
}
