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
  state: Pick<TripExecutionState, 'completedDayIds' | 'executionDayId'>,
): boolean {
  const finalDayId = trip.days.at(-1)?.id;
  return Boolean(
    finalDayId &&
    state.completedDayIds.includes(finalDayId) &&
    (state.executionDayId === undefined || state.executionDayId === finalDayId),
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
    return state.completedDayIds.includes(state.executionDayId)
      ? { status: 'DAY_COMPLETE', dayId: state.executionDayId }
      : { status: 'ACTIVE', dayId: state.executionDayId };
  }
  if (lastCompletedDayId) {
    return { status: 'DAY_COMPLETE', dayId: lastCompletedDayId };
  }
  return { status: 'READY' };
}
