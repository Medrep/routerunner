import {
  isSightseeingStop,
  orderedDayPlan,
  type Stop,
  type StopExecution,
  type StopId,
  type Trip,
  type TripDay,
  type TripExecutionState,
} from '../../domain/index.ts';

export type DayLifecyclePresentationStatus =
  | 'active'
  | 'completed'
  | 'upcoming';

export type PlannedStopPresentationStatus =
  | 'completed'
  | 'skipped'
  | 'saved'
  | 'planned';

export interface PlannedStopHistoryPresentation {
  readonly stop: Stop;
  readonly stopId: StopId;
  readonly itineraryPosition: number;
  readonly sightseeingPosition?: number;
  readonly plannedStartTime?: string;
  readonly status: PlannedStopPresentationStatus;
  readonly completedOnDayId?: string;
  readonly completedOnDayLabel?: string;
  readonly completedEarly: boolean;
  readonly rescheduled: boolean;
}

export interface TripOverviewDayPresentation {
  readonly day: TripDay;
  readonly dayId: string;
  readonly dayNumber: number;
  readonly label: string;
  readonly lifecycleStatus: DayLifecyclePresentationStatus;
  readonly isExecutionDay: boolean;
  readonly isViewed: boolean;
  readonly plannedStopCount: number;
  readonly sightseeingStopCount: number;
  readonly logisticsStopCount: number;
  readonly completedStopCount: number;
  readonly skippedStopCount: number;
  readonly savedStopCount: number;
  readonly stopNames: readonly string[];
  readonly stops: readonly PlannedStopHistoryPresentation[];
}

export interface TripOverviewPresentation {
  readonly viewedDayId?: string;
  readonly executionViewDayId?: string;
  readonly isReadOnlyPreview: boolean;
  readonly executionContext?: {
    readonly dayId: string;
    readonly dayLabel: string;
    readonly currentStopId?: StopId;
    readonly currentStopName?: string;
  };
  readonly days: readonly TripOverviewDayPresentation[];
}

function dayLabel(dayIndex: number): string {
  return `Day ${dayIndex + 1}`;
}

function plannedStopStatus(
  execution: StopExecution | undefined,
): PlannedStopPresentationStatus {
  if (execution?.status === 'completed') return 'completed';
  if (execution?.status === 'skipped') return 'skipped';
  if (execution?.status === 'pending' && execution.scheduledDayId === null) {
    return 'saved';
  }
  return 'planned';
}

/**
 * The execution day is the default view whenever one exists. READY trips use
 * the first canonical Trip.days entry. The choice is presentation-only.
 */
export function defaultViewedDayId(
  trip: Pick<Trip, 'days'>,
  state: Pick<TripExecutionState, 'executionDayId'>,
): string | undefined {
  if (
    state.executionDayId &&
    trip.days.some((day) => day.id === state.executionDayId)
  ) {
    return state.executionDayId;
  }
  return trip.days[0]?.id;
}

/** Resolves an invalid or absent transient view back to the deterministic default. */
export function resolveViewedDayId(
  trip: Pick<Trip, 'days'>,
  state: Pick<TripExecutionState, 'executionDayId'>,
  viewedDayId: string | undefined,
): string | undefined {
  return trip.days.some((day) => day.id === viewedDayId)
    ? viewedDayId
    : defaultViewedDayId(trip, state);
}

/**
 * Builds the overview and original-plan day preview without changing Trip or
 * TripExecutionState. Viewed is orthogonal to lifecycle status.
 */
export function deriveTripOverviewPresentation(
  trip: Trip,
  state: TripExecutionState,
  transientViewedDayId?: string,
): TripOverviewPresentation {
  const viewedDayId = resolveViewedDayId(trip, state, transientViewedDayId);
  const executionViewDayId = defaultViewedDayId(trip, state);
  const stopsById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  const dayNumberById = new Map(
    trip.days.map((day, index) => [day.id, index + 1]),
  );

  const days = trip.days.map<TripOverviewDayPresentation>((day, dayIndex) => {
    let sightseeingPosition = 0;
    const stops = orderedDayPlan(day).flatMap<PlannedStopHistoryPresentation>(
      (planItem, planIndex) => {
        const stop = stopsById.get(planItem.stopId);
        if (!stop) return [];
        const position = isSightseeingStop(stop)
          ? ++sightseeingPosition
          : undefined;
        const execution = state.stopExecutions[planItem.stopId];
        const completedOnDayNumber = execution?.completedOnDayId
          ? dayNumberById.get(execution.completedOnDayId)
          : undefined;

        return [
          {
            stop,
            stopId: stop.id,
            itineraryPosition: planIndex + 1,
            ...(position === undefined
              ? {}
              : { sightseeingPosition: position }),
            ...(planItem.plannedStartTime === undefined
              ? {}
              : { plannedStartTime: planItem.plannedStartTime }),
            status: plannedStopStatus(execution),
            ...(execution?.completedOnDayId === undefined
              ? {}
              : { completedOnDayId: execution.completedOnDayId }),
            ...(completedOnDayNumber === undefined
              ? {}
              : { completedOnDayLabel: dayLabel(completedOnDayNumber - 1) }),
            completedEarly:
              execution?.status === 'completed' &&
              execution.completedOnDayId !== undefined &&
              execution.completedOnDayId !== day.id,
            rescheduled:
              execution?.scheduledDayId !== null &&
              execution?.scheduledDayId !== undefined &&
              execution.scheduledDayId !== day.id,
          },
        ];
      },
    );
    const lifecycleStatus: DayLifecyclePresentationStatus =
      state.completedDayIds.includes(day.id)
        ? 'completed'
        : state.executionDayId === day.id
          ? 'active'
          : 'upcoming';

    return {
      day,
      dayId: day.id,
      dayNumber: dayIndex + 1,
      label: dayLabel(dayIndex),
      lifecycleStatus,
      isExecutionDay: state.executionDayId === day.id,
      isViewed: viewedDayId === day.id,
      plannedStopCount: stops.length,
      sightseeingStopCount: stops.filter(({ stop }) => isSightseeingStop(stop))
        .length,
      logisticsStopCount: stops.filter(({ stop }) => !isSightseeingStop(stop))
        .length,
      completedStopCount: stops.filter((stop) => stop.status === 'completed')
        .length,
      skippedStopCount: stops.filter((stop) => stop.status === 'skipped')
        .length,
      savedStopCount: stops.filter((stop) => stop.status === 'saved').length,
      stopNames: stops.map(({ stop }) => stop.name),
      stops,
    };
  });
  const executionDayIndex = trip.days.findIndex(
    (day) => day.id === state.executionDayId,
  );
  const currentStop = trip.stops.find(
    (stop) => stop.id === state.currentStopId,
  );

  return {
    ...(viewedDayId === undefined ? {} : { viewedDayId }),
    ...(executionViewDayId === undefined ? {} : { executionViewDayId }),
    isReadOnlyPreview:
      viewedDayId !== undefined && viewedDayId !== executionViewDayId,
    ...(executionDayIndex < 0 || state.executionDayId === undefined
      ? {}
      : {
          executionContext: {
            dayId: state.executionDayId,
            dayLabel: dayLabel(executionDayIndex),
            ...(state.currentStopId === undefined
              ? {}
              : { currentStopId: state.currentStopId }),
            ...(currentStop === undefined
              ? {}
              : { currentStopName: currentStop.name }),
          },
        }),
    days,
  };
}
