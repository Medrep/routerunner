import {
  skipCurrentStop,
  type TransitionResult,
} from '../../domain/execution/transitions.ts';
import type { TripExecutionState } from '../../domain/execution/types.ts';
import type { Trip } from '../../domain/trip/types.ts';

export type ManualSkipResult =
  | { status: 'cancelled' }
  | { status: 'transition'; result: TransitionResult };

/** UI boundary for manual Current Skip; domain eligibility remains canonical. */
export function manualSkipCurrentStop(
  trip: Trip,
  state: TripExecutionState,
  now: string,
  confirmMustStop: (message: string) => boolean,
): ManualSkipResult {
  const current = trip.stops.find((stop) => stop.id === state.currentStopId);
  if (
    current?.priority === 'must' &&
    !confirmMustStop(`Skip must-see stop ${current.name}?`)
  ) {
    return { status: 'cancelled' };
  }

  return {
    status: 'transition',
    result: skipCurrentStop(trip, state, now),
  };
}
