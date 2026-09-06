import { originalPlannedDayId } from '../trip/original-planned-day.ts';
import type { Trip } from '../trip/types.ts';
import type { StopExecution, TripExecutionState } from './types.ts';

/** Creates trip-owned runtime state without starting an execution day. */
export function createInitialTripExecutionState(
  trip: Trip,
  now: string,
): TripExecutionState {
  const stopExecutions = Object.fromEntries(
    trip.stops.map((stop) => {
      const execution: StopExecution = {
        stopId: stop.id,
        status: 'pending',
        scheduledDayId: originalPlannedDayId(trip, stop.id),
      };

      return [stop.id, execution];
    }),
  ) as TripExecutionState['stopExecutions'];

  return {
    tripId: trip.id,
    stopExecutions,
    doNowQueue: [],
    completedDayIds: [],
    ruleAcknowledgements: [],
    lastUpdatedAt: now,
  };
}
