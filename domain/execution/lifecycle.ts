import type { Trip } from '../trip/types.ts';
import type { TripExecutionState } from './types.ts';

export type TripExecutionLifecycle =
  | { status: 'READY' }
  | { status: 'ACTIVE'; dayId: string }
  | { status: 'DAY_COMPLETE'; dayId: string }
  | { status: 'TRIP_COMPLETE'; dayId?: string };

/** Terminal completion is derived from the canonical completed-day set. */
export function isTripComplete(
  trip: Pick<Trip, 'days'>,
  state: Pick<TripExecutionState, 'completedDayIds'>,
): boolean {
  return (
    trip.days.length > 0 &&
    trip.days.every((day) => state.completedDayIds.includes(day.id))
  );
}

/** Derives the execution shell state without persisting a competing flag. */
export function tripExecutionLifecycle(
  trip: Pick<Trip, 'days'>,
  state: Pick<TripExecutionState, 'completedDayIds' | 'executionDayId'>,
): TripExecutionLifecycle {
  const lastCompletedDayId = [...state.completedDayIds]
    .reverse()
    .find((dayId) => trip.days.some((day) => day.id === dayId));

  if (isTripComplete(trip, state)) {
    return {
      status: 'TRIP_COMPLETE',
      ...(lastCompletedDayId === undefined
        ? {}
        : { dayId: lastCompletedDayId }),
    };
  }
  if (state.executionDayId) {
    return { status: 'ACTIVE', dayId: state.executionDayId };
  }
  if (lastCompletedDayId) {
    return { status: 'DAY_COMPLETE', dayId: lastCompletedDayId };
  }
  return { status: 'READY' };
}
