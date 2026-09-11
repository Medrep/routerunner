import {
  isSightseeingStop,
  orderedDayPlan,
  stopMarkerLabel,
  type DayPlanItem,
  type Stop,
  type StopId,
  type TripDay,
} from '../../domain/index.ts';

export interface DayPlanStopPresentation {
  readonly planItem: DayPlanItem;
  readonly stop: Stop;
  readonly plannedStartTime?: string;
  readonly sightseeingPosition?: number;
  readonly markerLabel: string;
}

/**
 * Joins each global Stop to its day placement without copying placement data
 * onto Stop or execution state. The supplied Trip data is not mutated.
 */
export function dayPlanPresentationModel(
  day: Pick<TripDay, 'plan'>,
  stops: readonly Stop[],
): DayPlanStopPresentation[] {
  const stopsById = new Map(stops.map((stop) => [stop.id, stop]));

  let sightseeingPosition = 0;
  return orderedDayPlan(day).flatMap((planItem) => {
    const stop = stopsById.get(planItem.stopId);
    const position =
      stop && isSightseeingStop(stop) ? ++sightseeingPosition : undefined;
    return stop
      ? [
          {
            planItem,
            stop,
            ...(position === undefined
              ? {}
              : { sightseeingPosition: position }),
            markerLabel: stopMarkerLabel(stop, position),
            ...(planItem.plannedStartTime !== undefined
              ? { plannedStartTime: planItem.plannedStartTime }
              : {}),
          },
        ]
      : [];
  });
}

/** Resolves Details/Current/Next metadata from the active day placement. */
export function plannedStopPresentation(
  model: readonly DayPlanStopPresentation[],
  stopId: StopId | null | undefined,
): DayPlanStopPresentation | null {
  if (stopId === null || stopId === undefined) return null;
  return model.find(({ stop }) => stop.id === stopId) ?? null;
}
