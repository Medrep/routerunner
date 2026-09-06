import type { StopId, Trip, TripDay } from '../trip/types.ts';
import type { StopExecution, TripExecutionState } from './types.ts';

export type TransitionErrorCode =
  | 'TRIP_STATE_MISMATCH'
  | 'DAY_NOT_FOUND'
  | 'EXECUTION_DAY_ALREADY_ACTIVE'
  | 'DAY_ALREADY_COMPLETED'
  | 'EXECUTION_DAY_NOT_ACTIVE'
  | 'CURRENT_NOT_FOUND'
  | 'CURRENT_STOP_NOT_FOUND'
  | 'CURRENT_EXECUTION_NOT_FOUND'
  | 'CURRENT_NOT_PENDING'
  | 'STOP_CANNOT_BE_SKIPPED';

export interface TransitionError {
  code: TransitionErrorCode;
  message: string;
}

type TransitionFailure = { ok: false; error: TransitionError };

export type TransitionResult =
  | { ok: true; state: TripExecutionState }
  | TransitionFailure;

type CurrentContext = {
  day: TripDay;
  stopId: StopId;
  execution: StopExecution;
};

function fail(code: TransitionErrorCode, message: string): TransitionFailure {
  return { ok: false, error: { code, message } };
}

function tripMatchesState(
  trip: Trip,
  state: TripExecutionState,
): TransitionFailure | undefined {
  if (trip.id !== state.tripId) {
    return fail(
      'TRIP_STATE_MISMATCH',
      `Execution state belongs to trip ${state.tripId}, not ${trip.id}.`,
    );
  }
}

/**
 * Returns the first pending stop that remains scheduled in the given static
 * day plan. The plan array is the immutable ordering authority.
 */
export function firstEligiblePendingStopId(
  trip: Pick<Trip, 'days'>,
  state: Pick<TripExecutionState, 'stopExecutions'>,
  dayId: string,
): StopId | undefined {
  const day = trip.days.find((candidate) => candidate.id === dayId);

  return day?.plan.find((item) => {
    const execution = state.stopExecutions[item.stopId];
    return (
      execution?.status === 'pending' && execution.scheduledDayId === dayId
    );
  })?.stopId;
}

/** Derives presentation Next without introducing a second state authority. */
export function nextEligiblePendingStopId(
  trip: Pick<Trip, 'days'>,
  state: Pick<
    TripExecutionState,
    'executionDayId' | 'currentStopId' | 'stopExecutions'
  >,
): StopId | undefined {
  if (!state.executionDayId || !state.currentStopId) return undefined;

  const day = trip.days.find(
    (candidate) => candidate.id === state.executionDayId,
  );
  if (!day) return undefined;

  const currentIndex = day.plan.findIndex(
    (item) => item.stopId === state.currentStopId,
  );
  if (currentIndex < 0) return undefined;

  return day.plan.slice(currentIndex + 1).find((item) => {
    const execution = state.stopExecutions[item.stopId];
    return (
      execution?.status === 'pending' &&
      execution.scheduledDayId === state.executionDayId
    );
  })?.stopId;
}

function currentContext(
  trip: Trip,
  state: TripExecutionState,
): CurrentContext | TransitionFailure {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;

  if (!state.executionDayId) {
    return fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.');
  }

  const day = trip.days.find(
    (candidate) => candidate.id === state.executionDayId,
  );
  if (!day) {
    return fail(
      'DAY_NOT_FOUND',
      `Active execution day ${state.executionDayId} does not exist.`,
    );
  }

  if (!state.currentStopId) {
    return fail('CURRENT_NOT_FOUND', 'No Current stop exists.');
  }

  if (!trip.stops.some((stop) => stop.id === state.currentStopId)) {
    return fail(
      'CURRENT_STOP_NOT_FOUND',
      `Current stop ${state.currentStopId} does not exist in the trip.`,
    );
  }

  const execution = state.stopExecutions[state.currentStopId];
  if (!execution) {
    return fail(
      'CURRENT_EXECUTION_NOT_FOUND',
      `Current stop ${state.currentStopId} has no execution state.`,
    );
  }

  return { day, stopId: state.currentStopId, execution };
}

function isFailure(
  value: CurrentContext | TransitionFailure,
): value is TransitionFailure {
  return 'ok' in value;
}

function withAdvancedCurrent(
  trip: Trip,
  state: TripExecutionState,
  priorCurrentStopId: StopId,
  now: string,
): TripExecutionState {
  const nextStopId = firstEligiblePendingStopId(
    trip,
    state,
    state.executionDayId!,
  );

  return {
    ...state,
    currentStopId: nextStopId,
    currentStepStartedAt: nextStopId ? now : undefined,
    currentInboundTravel: nextStopId
      ? {
          fromStopId: priorCurrentStopId,
          toStopId: nextStopId,
          duration: { status: 'unknown', reason: 'unresolved' },
        }
      : undefined,
    lastUpdatedAt: now,
  };
}

export function startDay(
  trip: Trip,
  state: TripExecutionState,
  dayId: string,
  now: string,
): TransitionResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;

  const day = trip.days.find((candidate) => candidate.id === dayId);
  if (!day) return fail('DAY_NOT_FOUND', `Day ${dayId} does not exist.`);

  if (state.executionDayId) {
    return fail(
      'EXECUTION_DAY_ALREADY_ACTIVE',
      `Execution day ${state.executionDayId} is already active.`,
    );
  }

  if (state.completedDayIds.includes(dayId)) {
    return fail('DAY_ALREADY_COMPLETED', `Day ${dayId} is already completed.`);
  }

  const currentStopId = firstEligiblePendingStopId(trip, state, day.id);
  return {
    ok: true,
    state: {
      ...state,
      executionDayId: day.id,
      executionDayStartedAt: now,
      currentStopId,
      currentStepStartedAt: currentStopId ? now : undefined,
      currentInboundTravel: currentStopId
        ? {
            fromStopId: null,
            toStopId: currentStopId,
            duration: { status: 'unknown', reason: 'unresolved' },
          }
        : undefined,
      lastUpdatedAt: now,
    },
  };
}

export function completeCurrentStop(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TransitionResult {
  const context = currentContext(trip, state);
  if (isFailure(context)) return context;

  if (context.execution.status !== 'pending') {
    return fail('CURRENT_NOT_PENDING', 'Current stop is not pending.');
  }

  const nextState: TripExecutionState = {
    ...state,
    stopExecutions: {
      ...state.stopExecutions,
      [context.stopId]: {
        ...context.execution,
        status: 'completed',
        completedRecordedAt: now,
        completedOnDayId: context.day.id,
      },
    },
  };

  return {
    ok: true,
    state: withAdvancedCurrent(trip, nextState, context.stopId, now),
  };
}

export function skipCurrentStop(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TransitionResult {
  const context = currentContext(trip, state);
  if (isFailure(context)) return context;

  if (context.execution.status !== 'pending') {
    return fail('CURRENT_NOT_PENDING', 'Current stop is not pending.');
  }

  const stop = trip.stops.find((candidate) => candidate.id === context.stopId)!;
  if (!stop.canSkip) {
    return fail('STOP_CANNOT_BE_SKIPPED', `${stop.name} cannot be skipped.`);
  }

  const {
    completedRecordedAt: _completedRecordedAt,
    completedOnDayId: _completedOnDayId,
    ...executionWithoutCompletion
  } = context.execution;
  const nextState: TripExecutionState = {
    ...state,
    stopExecutions: {
      ...state.stopExecutions,
      [context.stopId]: {
        ...executionWithoutCompletion,
        status: 'skipped',
      },
    },
  };

  return {
    ok: true,
    state: withAdvancedCurrent(trip, nextState, context.stopId, now),
  };
}

export function saveCurrentForLater(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TransitionResult {
  const context = currentContext(trip, state);
  if (isFailure(context)) return context;

  if (context.execution.status !== 'pending') {
    return fail('CURRENT_NOT_PENDING', 'Current stop is not pending.');
  }

  const {
    completedRecordedAt: _completedRecordedAt,
    completedOnDayId: _completedOnDayId,
    ...executionWithoutCompletion
  } = context.execution;
  const nextState: TripExecutionState = {
    ...state,
    stopExecutions: {
      ...state.stopExecutions,
      [context.stopId]: {
        ...executionWithoutCompletion,
        scheduledDayId: null,
      },
    },
  };

  return {
    ok: true,
    state: withAdvancedCurrent(trip, nextState, context.stopId, now),
  };
}
