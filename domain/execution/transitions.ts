import type { DayPlanItem, StopId, Trip, TripDay } from '../trip/types.ts';
import {
  activeExecutionRecommendation,
  projectSchedule,
} from '../schedule/project-schedule.ts';
import { isTripComplete } from './lifecycle.ts';
import type { StopExecution, TripExecutionState } from './types.ts';

export type TransitionErrorCode =
  | 'TRIP_STATE_MISMATCH'
  | 'DAY_NOT_FOUND'
  | 'EXECUTION_DAY_ALREADY_ACTIVE'
  | 'DAY_ALREADY_COMPLETED'
  | 'DAY_NOT_COMPLETED'
  | 'EXECUTION_DAY_NOT_ACTIVE'
  | 'EXECUTABLE_WORK_REMAINS'
  | 'DO_NOW_QUEUE_NOT_EMPTY'
  | 'TRIP_COMPLETE'
  | 'CURRENT_NOT_FOUND'
  | 'CURRENT_STOP_NOT_FOUND'
  | 'CURRENT_EXECUTION_NOT_FOUND'
  | 'CURRENT_NOT_PENDING'
  | 'STOP_CANNOT_BE_SKIPPED'
  | 'STOP_NOT_FOUND'
  | 'STOP_NOT_PENDING'
  | 'STOP_NOT_ACTIVE_DAY'
  | 'STOP_IS_CURRENT'
  | 'STOP_QUEUED'
  | 'RULE_NOT_FOUND'
  | 'RULE_NOT_ACTIVE_DAY'
  | 'RECOMMENDATION_NOT_ACTIVE';

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

function terminalFailure(
  trip: Trip,
  state: TripExecutionState,
): TransitionFailure | undefined {
  if (isTripComplete(trip, state)) {
    return fail('TRIP_COMPLETE', 'Trip execution is complete.');
  }
}

/** Returns a canonical plan view without mutating the TripDay source array. */
export function orderedDayPlan(day: Pick<TripDay, 'plan'>): DayPlanItem[] {
  return [...day.plan].sort((left, right) => left.order - right.order);
}

/** Returns the first pending stop in canonical numeric plan order. */
export function firstEligiblePendingStopId(
  trip: Pick<Trip, 'days'>,
  state: Pick<TripExecutionState, 'stopExecutions'>,
  dayId: string,
): StopId | undefined {
  const day = trip.days.find((candidate) => candidate.id === dayId);

  return (
    day &&
    orderedDayPlan(day).find((item) => {
      const execution = state.stopExecutions[item.stopId];
      return (
        execution?.status === 'pending' && execution.scheduledDayId === dayId
      );
    })?.stopId
  );
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

  const orderedPlan = orderedDayPlan(day);
  const currentIndex = orderedPlan.findIndex(
    (item) => item.stopId === state.currentStopId,
  );
  if (currentIndex < 0) return undefined;

  return orderedPlan.slice(currentIndex + 1).find((item) => {
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
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;

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
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;

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

/**
 * Explicitly completes the active lifecycle day. Pending work scheduled to the
 * day and queued Do Now work must be resolved by their own transitions first.
 */
export function endDay(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TransitionResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;
  if (!state.executionDayId) {
    return fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.');
  }

  const dayId = state.executionDayId;
  if (!trip.days.some((day) => day.id === dayId)) {
    return fail(
      'DAY_NOT_FOUND',
      `Active execution day ${dayId} does not exist.`,
    );
  }
  if (state.completedDayIds.includes(dayId)) {
    return fail('DAY_ALREADY_COMPLETED', `Day ${dayId} is already completed.`);
  }
  if (state.doNowQueue.length > 0) {
    return fail(
      'DO_NOW_QUEUE_NOT_EMPTY',
      'Queued Do Now work must be resolved before ending the day.',
    );
  }
  if (
    state.currentStopId !== undefined ||
    Object.values(state.stopExecutions).some(
      (execution) =>
        execution.status === 'pending' && execution.scheduledDayId === dayId,
    )
  ) {
    return fail(
      'EXECUTABLE_WORK_REMAINS',
      'Executable work remains for the active day.',
    );
  }

  return {
    ok: true,
    state: {
      ...state,
      executionDayId: undefined,
      executionDayStartedAt: undefined,
      currentStopId: undefined,
      currentStepStartedAt: undefined,
      currentInboundTravel: undefined,
      completedDayIds: [...new Set([...state.completedDayIds, dayId])],
      lastUpdatedAt: now,
    },
  };
}

/** Reopens only day lifecycle; Stop execution and scheduling remain unchanged. */
export function reopenCompletedDay(
  trip: Trip,
  state: TripExecutionState,
  dayId: string,
  now: string,
): TransitionResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;
  if (!trip.days.some((day) => day.id === dayId)) {
    return fail('DAY_NOT_FOUND', `Day ${dayId} does not exist.`);
  }
  if (!state.completedDayIds.includes(dayId)) {
    return fail('DAY_NOT_COMPLETED', `Day ${dayId} is not completed.`);
  }
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;

  return {
    ok: true,
    state: {
      ...state,
      completedDayIds: state.completedDayIds.filter(
        (completedDayId) => completedDayId !== dayId,
      ),
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

  return {
    ok: true,
    state: withAdvancedCurrent(
      trip,
      withSkippedExecution(state, context.stopId, now),
      context.stopId,
      now,
    ),
  };
}

function withSkippedExecution(
  state: TripExecutionState,
  stopId: StopId,
  now: string,
): TripExecutionState {
  const {
    completedRecordedAt: _completedRecordedAt,
    completedOnDayId: _completedOnDayId,
    ...executionWithoutCompletion
  } = state.stopExecutions[stopId];
  return {
    ...state,
    stopExecutions: {
      ...state.stopExecutions,
      [stopId]: {
        ...executionWithoutCompletion,
        status: 'skipped',
      },
    },
    lastUpdatedAt: now,
  };
}

/** Canonical Skip mutation for an eligible non-Current recommendation target. */
function skipFutureTarget(
  trip: Trip,
  state: TripExecutionState,
  stopId: StopId,
  now: string,
): TransitionResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;
  if (!state.executionDayId) {
    return fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.');
  }
  const stop = trip.stops.find((candidate) => candidate.id === stopId);
  if (!stop) return fail('STOP_NOT_FOUND', `Stop ${stopId} does not exist.`);
  const execution = state.stopExecutions[stopId];
  if (execution?.status !== 'pending') {
    return fail('STOP_NOT_PENDING', `${stop.name} is no longer pending.`);
  }
  if (execution.scheduledDayId !== state.executionDayId) {
    return fail(
      'STOP_NOT_ACTIVE_DAY',
      `${stop.name} is not planned for the active execution day.`,
    );
  }
  if (state.currentStopId === stopId) {
    return fail('STOP_IS_CURRENT', `${stop.name} is Current.`);
  }
  if (state.doNowQueue.some((entry) => entry.stopId === stopId)) {
    return fail('STOP_QUEUED', `${stop.name} is queued for Do Now.`);
  }
  if (!stop.canSkip) {
    return fail('STOP_CANNOT_BE_SKIPPED', `${stop.name} cannot be skipped.`);
  }

  return {
    ok: true,
    state: withSkippedExecution(state, stopId, now),
  };
}

/** Accepts Skip only for the currently active, re-derived prepared rule. */
export function acceptSkipRecommendation(
  trip: Trip,
  state: TripExecutionState,
  ruleId: string,
  now: string,
): TransitionResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;
  if (!state.executionDayId) {
    return fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.');
  }
  const rule = (trip.rules ?? []).find((candidate) => candidate.id === ruleId);
  if (!rule) return fail('RULE_NOT_FOUND', `Rule ${ruleId} does not exist.`);
  if (rule.dayId !== state.executionDayId) {
    return fail(
      'RULE_NOT_ACTIVE_DAY',
      `Rule ${ruleId} does not belong to the active execution day.`,
    );
  }

  const recommendation = activeExecutionRecommendation(
    trip,
    state,
    projectSchedule(trip, state, now),
  );
  if (recommendation?.ruleId !== ruleId) {
    return fail(
      'RECOMMENDATION_NOT_ACTIVE',
      `Rule ${ruleId} is not an active recommendation.`,
    );
  }

  return skipFutureTarget(trip, state, recommendation.targetStopId, now);
}

/** Persists Keep It only for the currently active, re-derived prepared rule. */
export function acknowledgeRuleRecommendation(
  trip: Trip,
  state: TripExecutionState,
  ruleId: string,
  now: string,
): TransitionResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;
  if (!state.executionDayId) {
    return fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.');
  }
  const rule = (trip.rules ?? []).find((candidate) => candidate.id === ruleId);
  if (!rule) return fail('RULE_NOT_FOUND', `Rule ${ruleId} does not exist.`);
  if (rule.dayId !== state.executionDayId) {
    return fail(
      'RULE_NOT_ACTIVE_DAY',
      `Rule ${ruleId} does not belong to the active execution day.`,
    );
  }

  const recommendation = activeExecutionRecommendation(
    trip,
    state,
    projectSchedule(trip, state, now),
  );
  if (recommendation?.ruleId !== ruleId) {
    return fail(
      'RECOMMENDATION_NOT_ACTIVE',
      `Rule ${ruleId} is not an active recommendation.`,
    );
  }

  const alreadyAcknowledged = state.ruleAcknowledgements.some(
    (entry) =>
      entry.ruleId === ruleId &&
      entry.executionDayId === state.executionDayId &&
      entry.severity === recommendation.severity,
  );
  return {
    ok: true,
    state: {
      ...state,
      ruleAcknowledgements: alreadyAcknowledged
        ? state.ruleAcknowledgements
        : [
            ...state.ruleAcknowledgements,
            {
              ruleId,
              executionDayId: state.executionDayId,
              severity: recommendation.severity,
              acknowledgedAt: now,
            },
          ],
      lastUpdatedAt: now,
    },
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
