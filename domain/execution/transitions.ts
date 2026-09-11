import type { StopId, Trip, TripDay } from '../trip/types.ts';
import {
  activeExecutionRecommendation,
  projectSchedule,
} from '../schedule/project-schedule.ts';
import { isTripComplete } from './lifecycle.ts';
import {
  activeDoNowOverride,
  firstEligibleNormalStopId,
  isActiveDoNowOverride,
  isWaitingDoNow,
  nextExecutionStopId,
  orderedDayPlan,
  waitingDoNowQueue,
} from './execution-order.ts';
import { isCanonicalIsoTimestamp, isKnownOrUnknownDuration } from './types.ts';
import type {
  KnownOrUnknownDuration,
  StopExecution,
  TripExecutionState,
} from './types.ts';

export type TransitionErrorCode =
  | 'TRIP_STATE_MISMATCH'
  | 'DAY_NOT_FOUND'
  | 'EXECUTION_DAY_ALREADY_ACTIVE'
  | 'DAY_ALREADY_COMPLETED'
  | 'DAY_NOT_COMPLETED'
  | 'EXECUTION_DAY_NOT_ACTIVE'
  | 'END_DAY_REQUIRES_RESOLUTION'
  | 'DAY_NOT_EXECUTION_CONTEXT'
  | 'NEXT_EXECUTION_DAY_REQUIRED'
  | 'EXECUTION_STATE_INCOHERENT'
  | 'INVALID_SWITCH_TIMESTAMP'
  | 'INVALID_INBOUND_DURATION'
  | 'INVALID_SWITCH_RESOLUTION'
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

export type SwitchExecutionDayResolution = 'save_all_for_later';

export type SwitchExecutionDayResult =
  | { status: 'switched'; state: TripExecutionState }
  | {
      status: 'leftover_resolution_required';
      oldDayId: string;
      targetDayId: string;
      remainingStopIds: StopId[];
    }
  | { status: 'rejected'; error: TransitionError };

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

/** Shared relationship guard used before switching and before persistence. */
export function hasCoherentExecutionStateRelationships(
  trip: Trip,
  state: TripExecutionState,
): boolean {
  const stopIds = new Set(trip.stops.map((stop) => stop.id));
  const dayIds = new Set(trip.days.map((day) => day.id));
  const executionEntries = Object.entries(state.stopExecutions);
  if (
    executionEntries.length !== stopIds.size ||
    executionEntries.some(
      ([stopId, execution]) =>
        !stopIds.has(stopId as StopId) ||
        execution.stopId !== stopId ||
        (execution.scheduledDayId !== null &&
          !dayIds.has(execution.scheduledDayId)) ||
        (execution.completedOnDayId !== undefined &&
          !dayIds.has(execution.completedOnDayId)),
    ) ||
    new Set(state.completedDayIds).size !== state.completedDayIds.length ||
    state.completedDayIds.some((dayId) => !dayIds.has(dayId))
  ) {
    return false;
  }

  for (const execution of Object.values(state.stopExecutions)) {
    const hasCompletedAt = execution.completedRecordedAt !== undefined;
    const hasCompletedDay = execution.completedOnDayId !== undefined;

    if (execution.status === 'completed') {
      if (!hasCompletedAt || !hasCompletedDay) return false;
    } else if (hasCompletedAt || hasCompletedDay) {
      return false;
    }
  }

  const completedDayIds = new Set(state.completedDayIds);
  if (
    Object.values(state.stopExecutions).some(
      (execution) =>
        execution.status === 'pending' &&
        execution.scheduledDayId !== null &&
        completedDayIds.has(execution.scheduledDayId),
    )
  ) {
    return false;
  }

  if (state.executionDayId === undefined) {
    return (
      state.completedDayIds.length === 0 &&
      state.executionDayStartedAt === undefined &&
      state.currentStopId === undefined &&
      state.currentStepStartedAt === undefined &&
      state.currentInboundTravel === undefined &&
      state.doNowQueue.length === 0
    );
  }

  if (
    !trip.days.some((day) => day.id === state.executionDayId) ||
    !isCanonicalIsoTimestamp(state.executionDayStartedAt)
  ) {
    return false;
  }

  const finalDayId = trip.days.at(-1)?.id;
  if (
    finalDayId &&
    state.completedDayIds.includes(finalDayId) &&
    state.executionDayId !== finalDayId
  ) {
    return false;
  }

  if (state.completedDayIds.includes(state.executionDayId)) {
    return (
      state.currentStopId === undefined &&
      state.currentStepStartedAt === undefined &&
      state.currentInboundTravel === undefined &&
      state.doNowQueue.length === 0 &&
      !Object.values(state.stopExecutions).some(
        (execution) =>
          execution.status === 'pending' &&
          execution.scheduledDayId === state.executionDayId,
      )
    );
  }

  const queuedStopIds = new Set<StopId>();
  for (const entry of state.doNowQueue) {
    const execution = state.stopExecutions[entry.stopId];
    if (
      queuedStopIds.has(entry.stopId) ||
      (entry.returnScheduledDayId !== null &&
        !dayIds.has(entry.returnScheduledDayId)) ||
      execution?.status !== 'pending' ||
      execution.scheduledDayId !== state.executionDayId
    ) {
      return false;
    }
    queuedStopIds.add(entry.stopId);
  }

  if (state.currentStopId === undefined) {
    return (
      state.currentStepStartedAt === undefined &&
      state.currentInboundTravel === undefined &&
      state.doNowQueue.length === 0
    );
  }

  const currentExecution = state.stopExecutions[state.currentStopId];
  const currentIsOverride = isActiveDoNowOverride(state, state.currentStopId);
  return (
    !isWaitingDoNow(state, state.currentStopId) &&
    currentExecution?.status === 'pending' &&
    currentExecution.scheduledDayId === state.executionDayId &&
    isCanonicalIsoTimestamp(state.currentStepStartedAt) &&
    new Date(state.currentStepStartedAt).valueOf() >=
      new Date(state.executionDayStartedAt).valueOf() &&
    state.currentInboundTravel !== undefined &&
    state.currentInboundTravel.toStopId === state.currentStopId &&
    (currentIsOverride ||
      firstEligibleNormalStopId(trip, state) === state.currentStopId)
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
  return nextExecutionStopId(trip, state);
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
  const doNowQueue = isActiveDoNowOverride(state, priorCurrentStopId)
    ? state.doNowQueue.slice(1)
    : state.doNowQueue;
  const stateAfterCurrent: TripExecutionState = { ...state, doNowQueue };
  const nextStopId = nextExecutionStopId(trip, stateAfterCurrent);

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
    waitingDoNowQueue(state).some(
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
  if (isWaitingDoNow(state, stopId)) {
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
  const currentIsOverride = activeDoNowOverride(state) !== undefined;
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

function switchRejected(failure: TransitionFailure): SwitchExecutionDayResult {
  return { status: 'rejected', error: failure.error };
}

/**
 * Atomically completes the retained execution day and starts its canonical
 * successor. Discovery never mutates state; only the explicit save-all
 * resolution may unschedule normal old-day leftovers.
 */
export function switchExecutionDay(
  trip: Trip,
  state: TripExecutionState,
  targetDayId: string,
  now: string,
  inboundDuration: KnownOrUnknownDuration,
  resolution?: SwitchExecutionDayResolution,
): SwitchExecutionDayResult {
  const mismatch = tripMatchesState(trip, state);
  if (mismatch) return switchRejected(mismatch);
  if (!isCanonicalIsoTimestamp(now)) {
    return switchRejected(
      fail(
        'INVALID_SWITCH_TIMESTAMP',
        'The execution-day switch timestamp is invalid.',
      ),
    );
  }
  if (!isKnownOrUnknownDuration(inboundDuration)) {
    return switchRejected(
      fail(
        'INVALID_INBOUND_DURATION',
        'The new execution-day inbound duration is invalid.',
      ),
    );
  }
  if (resolution !== undefined && resolution !== 'save_all_for_later') {
    return switchRejected(
      fail(
        'INVALID_SWITCH_RESOLUTION',
        'The execution-day switch resolution is unsupported.',
      ),
    );
  }
  const terminal = terminalFailure(trip, state);
  if (terminal) return switchRejected(terminal);

  const targetDay = trip.days.find((day) => day.id === targetDayId);
  if (!targetDay) {
    return switchRejected(
      fail('DAY_NOT_FOUND', `Day ${targetDayId} does not exist.`),
    );
  }
  if (!state.executionDayId) {
    return switchRejected(
      fail('EXECUTION_DAY_NOT_ACTIVE', 'No execution day is active.'),
    );
  }
  if (state.executionDayId === targetDayId) {
    return switchRejected(
      fail(
        'EXECUTION_DAY_ALREADY_ACTIVE',
        `Execution day ${targetDayId} is already active.`,
      ),
    );
  }

  const oldDayIndex = trip.days.findIndex(
    (day) => day.id === state.executionDayId,
  );
  if (oldDayIndex < 0) {
    return switchRejected(
      fail(
        'DAY_NOT_FOUND',
        `Active execution day ${state.executionDayId} does not exist.`,
      ),
    );
  }
  if (trip.days[oldDayIndex + 1]?.id !== targetDayId) {
    return switchRejected(
      fail(
        'NEXT_EXECUTION_DAY_REQUIRED',
        `Day ${targetDayId} is not the next planned execution day.`,
      ),
    );
  }
  if (state.completedDayIds.includes(targetDayId)) {
    return switchRejected(
      fail('DAY_ALREADY_COMPLETED', `Day ${targetDayId} is already completed.`),
    );
  }
  if (!hasCoherentExecutionStateRelationships(trip, state)) {
    return switchRejected(
      fail(
        'EXECUTION_STATE_INCOHERENT',
        'The current execution state is not coherent enough to switch days.',
      ),
    );
  }

  // Restore temporary planning overrides before classifying normal leftovers.
  const restored = withCancelledDoNowOverrides(state);
  const remainingStopIds = Object.values(restored.stopExecutions)
    .filter(
      (execution) =>
        execution.status === 'pending' &&
        execution.scheduledDayId === state.executionDayId,
    )
    .map((execution) => execution.stopId);

  if (remainingStopIds.length > 0 && resolution === undefined) {
    return {
      status: 'leftover_resolution_required',
      oldDayId: state.executionDayId,
      targetDayId,
      remainingStopIds,
    };
  }

  let resolved = restored;
  if (remainingStopIds.length > 0) {
    const stopExecutions = { ...restored.stopExecutions };
    for (const stopId of remainingStopIds) {
      stopExecutions[stopId] = {
        ...stopExecutions[stopId],
        scheduledDayId: null,
      };
    }
    resolved = { ...restored, stopExecutions };
  }

  const oldDayComplete = state.completedDayIds.includes(state.executionDayId)
    ? resolved
    : withCompletedDay(resolved, now);
  const currentStopId = firstEligiblePendingStopId(
    trip,
    oldDayComplete,
    targetDayId,
  );
  const switched: TripExecutionState = {
    ...oldDayComplete,
    executionDayId: targetDayId,
    executionDayStartedAt: now,
    currentStopId,
    currentStepStartedAt: currentStopId ? now : undefined,
    currentInboundTravel: currentStopId
      ? {
          fromStopId: null,
          toStopId: currentStopId,
          duration: inboundDuration,
        }
      : undefined,
    lastUpdatedAt: now,
  };

  if (!hasCoherentExecutionStateRelationships(trip, switched)) {
    return switchRejected(
      fail(
        'EXECUTION_STATE_INCOHERENT',
        'The requested day switch would produce an incoherent execution state.',
      ),
    );
  }
  return { status: 'switched', state: switched };
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
  if (isWaitingDoNow(state, stopId)) {
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
