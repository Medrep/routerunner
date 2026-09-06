import type { StopId, Trip } from './types.ts';

/**
 * Derives immutable planning ownership from the static itinerary.
 * Returns null when a stop is not present in any day plan.
 */
export function originalPlannedDayId(
  trip: Pick<Trip, 'days'>,
  stopId: StopId,
): string | null {
  return (
    trip.days.find((day) =>
      day.plan.some((planItem) => planItem.stopId === stopId),
    )?.id ?? null
  );
}
