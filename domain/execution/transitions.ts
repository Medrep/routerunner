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
  | 'END_DAY_REQUIRES_RESOLUTION'
  | 'DAY_NOT_EXECUTION_CONTEXT'
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
    'doNowQueue' | 'executionDayId' | 'currentStopId' | 'stopExecutions'
  >,
): StopId | undefined {
  if (!state.executionDayId || !state.currentStopId) return undefined;

  const currentQueueIndex = state.doNowQueue.findIndex(
    (entry) => entry.stopId === state.currentStopId,
  );
  const queuedEntries =
    currentQueueIndex < 0
      ? state.doNowQueue
      : state.doNowQueue.slice(currentQueueIndex + 1);
  const queuedStopId = queuedEntries.find(
    (entry) => state.stopExecutions[entry.stopId]?.status === 'pending',
  )?.stopId;
  if (queuedStopId) return queuedStopId;

  const day = trip.days.find(
    (candidate) => candidate.id === state.executionDayId,
  );
  if (!day) return undefined;

  const orderedPlan = orderedDayPlan(day);
  const currentIndex = orderedPlan.findIndex(
    (item) => item.stopId === state.currentStopId,
  );
  const remainingPlan =
    currentIndex < 0 ? orderedPlan : orderedPlan.slice(currentIndex + 1);
  return remainingPlan.find((item) => {
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
  const doNowQueue = state.doNowQueue.filter(
    (entry) => entry.stopId !== priorCurrentStopId,
  );
  const stateAfterCurrent: TripExecutionState = { ...state, doNowQueue };
  const nextStopId =
    doNowQueue.find(
      (entry) =>
        stateAfterCurrent.stopExecutions[entry.stopId]?.status === 'pending',
    )?.stopId ??
    firstEligiblePendingStopId(
      trip,
      stateAfterCurrent,
      stateAfterCurrent.executionDayId!,
    );

  const advanced: TripExecutionState = {
    ...stateAfterCurrent,
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
  return nextStopId ? advanced : withNaturallyCompletedDay(advanced, now);
}

function withCompletedDay(
  state: TripExecutionState,
  now: string,
): TripExecutionState {
  const dayId = state.executionDayId!;
  return {
    ...state,
    currentStopId: undefined,
    currentStepStartedAt: undefined,
    currentInboundTravel: undefined,
    doNowQueue: [],
    completedDayIds: [...new Set([...state.completedDayIds, dayId])],
    lastUpdatedAt: now,
  };
}

function hasEligibleExecutionWork(state: TripExecutionState): boolean {
  if (!state.executionDayId) return false;
  return Boolean(
    state.currentStopId ||
    state.doNowQueue.some(
      (entry) => state.stopExecutions[entry.stopId]?.status === 'pending',
    ) ||
    Object.values(state.stopExecutions).some(
      (execution) =>
        execution.status === 'pending' &&
        execution.scheduledDayId === state.executionDayId,
    ),
  );
}

/** Called only after an execution transition, never merely because Current is null. */
function withNaturallyCompletedDay(
  state: TripExecutionState,
  now: string,
): TripExecutionState {
  return state.executionDayId && !hasEligibleExecutionWork(state)
    ? withCompletedDay(state, now)
    : state;
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

/** Minimal Do Now boundary needed to resume a reversible completed day. */
export function doNowStop(
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
  if (state.currentStopId === stopId) {
    return fail('STOP_IS_CURRENT', `${stop.name} is Current.`);
  }
  if (state.doNowQueue.some((entry) => entry.stopId === stopId)) {
    return fail('STOP_QUEUED', `${stop.name} is queued for Do Now.`);
  }

  const becomesCurrent = state.currentStopId === undefined;
  return {
    ok: true,
    state: {
      ...state,
      completedDayIds: state.completedDayIds.filter(
        (dayId) => dayId !== state.executionDayId,
      ),
      stopExecutions: {
        ...state.stopExecutions,
        [stopId]: {
          ...execution,
          scheduledDayId: state.executionDayId,
        },
      },
      doNowQueue: [
        ...state.doNowQueue,
        { stopId, returnScheduledDayId: execution.scheduledDayId },
      ],
      currentStopId: becomesCurrent ? stopId : state.currentStopId,
      currentStepStartedAt: becomesCurrent ? now : state.currentStepStartedAt,
      currentInboundTravel: becomesCurrent
        ? {
            fromStopId: null,
            toStopId: stopId,
            duration: { status: 'unknown', reason: 'unresolved' },
          }
        : state.currentInboundTravel,
      lastUpdatedAt: now,
    },
  };
}

function withCancelledDoNowOverrides(
  state: TripExecutionState,
): TripExecutionState {
  const queuedByStopId = new Map(
    state.doNowQueue.map((entry) => [entry.stopId, entry]),
  );
  const currentIsOverride =
    state.currentStopId !== undefined &&
    queuedByStopId.has(state.currentStopId);
  const stopExecutions = { ...state.stopExecutions };
  for (const entry of state.doNowQueue) {
    const execution = stopExecutions[entry.stopId];
    if (execution?.status === 'pending') {
      stopExecutions[entry.stopId] = {
        ...execution,
        scheduledDayId: entry.returnScheduledDayId,
      };
    }
  }

  return {
    ...state,
    stopExecutions,
    doNowQueue: [],
    currentStopId: currentIsOverride ? undefined : state.currentStopId,
    currentStepStartedAt: currentIsOverride
      ? undefined
      : state.currentStepStartedAt,
    currentInboundTravel: currentIsOverride
      ? undefined
      : state.currentInboundTravel,
  };
}

function validateEndDayContext(
  trip: Trip,
  state: TripExecutionState,
): TransitionFailure | string {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return mismatch;
  const terminal = terminalFailure(trip, state);
  if (terminal) return terminal;
  if (!state.executionDayId) {
    return fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.');
  }
  if (!trip.days.some((day) => day.id === state.executionDayId)) {
    return fail(
      'DAY_NOT_FOUND',
      `Active execution day ${state.executionDayId} does not exist.`,
    );
  }
  if (state.completedDayIds.includes(state.executionDayId)) {
    return fail(
      'DAY_ALREADY_COMPLETED',
      `Day ${state.executionDayId} is already completed.`,
    );
  }
  return state.executionDayId;
}

/**
 * Explicitly completes a zero/resolved day, cancelling unfinished Do Now
 * overrides. Normal scheduled work requires the bounded resolution flow.
 */
export function endDay(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TransitionResult {
  const context = validateEndDayContext(trip, state);
  if (typeof context !== 'string') return context;
  const restored = withCancelledDoNowOverrides(state);
  if (hasEligibleExecutionWork(restored)) {
    return fail(
      'END_DAY_REQUIRES_RESOLUTION',
      'Choose how to resolve remaining scheduled work before ending the day.',
    );
  }
  return { ok: true, state: withCompletedDay(restored, now) };
}

/** Resolves all normal current-day pending work without Skip or completion. */
export function saveAllForLaterAndEndDay(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): TransitionResult {
  const context = validateEndDayContext(trip, state);
  if (typeof context !== 'string') return context;
  const restored = withCancelledDoNowOverrides(state);
  const stopExecutions = { ...restored.stopExecutions };
  for (const execution of Object.values(stopExecutions)) {
    if (
      execution.status === 'pending' &&
      execution.scheduledDayId === context
    ) {
      stopExecutions[execution.stopId] = {
        ...execution,
        scheduledDayId: null,
      };
    }
  }
  return {
    ok: true,
    state: withCompletedDay(
      {
        ...restored,
        stopExecutions,
        currentStopId: undefined,
        currentStepStartedAt: undefined,
        currentInboundTravel: undefined,
      },
      now,
    ),
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
  if (state.executionDayId !== dayId) {
    return fail(
      'DAY_NOT_EXECUTION_CONTEXT',
      `Day ${dayId} is not the retained execution day.`,
    );
  }

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
    state: withNaturallyCompletedDay(
      withSkippedExecution(state, stopId, now),
      now,
    ),
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
