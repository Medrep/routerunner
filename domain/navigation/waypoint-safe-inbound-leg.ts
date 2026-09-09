import type { TripExecutionState } from '../execution/types.ts';
import type { Leg, Trip } from '../trip/types.ts';

export function resolveCurrentInboundLeg(
  trip: Trip,
  state: TripExecutionState,
): Leg | undefined {
  const inbound = state.currentInboundTravel;
  if (
    !state.currentStopId ||
    !inbound?.fromStopId ||
    inbound.toStopId !== state.currentStopId
  ) {
    return undefined;
  }

  const matches = (trip.legs ?? []).filter(
    (leg) =>
      leg.fromStopId === inbound.fromStopId &&
      leg.toStopId === inbound.toStopId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolves the sole inbound Leg whose waypoint data is safe to reuse after
 * execution. Skipped, saved, missing, mismatched, or ambiguous provenance is
 * deliberately rejected.
 */
export function resolveWaypointSafeInboundLeg(
  trip: Trip,
  state: TripExecutionState,
): Leg | undefined {
  const leg = resolveCurrentInboundLeg(trip, state);
  if (leg?.mode !== 'walk' || !leg.navigationWaypoints?.length) {
    return undefined;
  }

  const sourceExecution = state.stopExecutions[leg.fromStopId];
  if (
    sourceExecution?.stopId !== leg.fromStopId ||
    sourceExecution.status !== 'completed'
  ) {
    return undefined;
  }

  return leg;
}
