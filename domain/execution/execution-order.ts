import type { DayPlanItem, StopId, Trip, TripDay } from '../trip/types.ts';
import type { DoNowQueueEntry, TripExecutionState } from './types.ts';

type DoNowRoleState = Pick<TripExecutionState, 'currentStopId' | 'doNowQueue'>;

type RouteOrderState = Pick<
  TripExecutionState,
  'currentStopId' | 'doNowQueue' | 'executionDayId' | 'stopExecutions'
>;

/** Returns a canonical plan view without mutating the TripDay source array. */
export function orderedDayPlan(day: Pick<TripDay, 'plan'>): DayPlanItem[] {
  return [...day.plan].sort((left, right) => left.order - right.order);
}

/** Queue head is active provenance only while it identifies Current. */
export function activeDoNowOverride(
  state: DoNowRoleState,
): DoNowQueueEntry | undefined {
  const head = state.doNowQueue[0];
  return head?.stopId === state.currentStopId ? head : undefined;
}

/** Entries after active provenance, or the whole ledger, are waiting FIFO. */
export function waitingDoNowQueue(
  state: DoNowRoleState,
): readonly DoNowQueueEntry[] {
  return activeDoNowOverride(state)
    ? state.doNowQueue.slice(1)
    : state.doNowQueue;
}

export function isActiveDoNowOverride(
  state: DoNowRoleState,
  stopId: StopId,
): boolean {
  return activeDoNowOverride(state)?.stopId === stopId;
}

export function isWaitingDoNow(state: DoNowRoleState, stopId: StopId): boolean {
  return waitingDoNowQueue(state).some((entry) => entry.stopId === stopId);
}

/**
 * Remaining normal work always resumes in canonical plan order. Do Now ledger
 * entries are excluded because active/waiting roles are represented separately.
 */
export function remainingEligibleNormalStopIds(
  trip: Pick<Trip, 'days'>,
  state: RouteOrderState,
): StopId[] {
  if (!state.executionDayId) return [];
  const day = trip.days.find(
    (candidate) => candidate.id === state.executionDayId,
  );
  if (!day) return [];

  const ledgerStopIds = new Set(state.doNowQueue.map((entry) => entry.stopId));
  return orderedDayPlan(day)
    .map((item) => item.stopId)
    .filter((stopId) => {
      const execution = state.stopExecutions[stopId];
      return (
        stopId !== state.currentStopId &&
        !ledgerStopIds.has(stopId) &&
        execution?.status === 'pending' &&
        execution.scheduledDayId === state.executionDayId
      );
    });
}

/** The first normal-route candidate, ignoring every Do Now ledger role. */
export function firstEligibleNormalStopId(
  trip: Pick<Trip, 'days'>,
  state: RouteOrderState,
): StopId | undefined {
  return remainingEligibleNormalStopIds(trip, {
    ...state,
    currentStopId: undefined,
  })[0];
}

function eligibleWaitingDoNowStopIds(state: RouteOrderState): StopId[] {
  if (!state.executionDayId) return [];
  const selected = new Set<StopId>();
  return waitingDoNowQueue(state)
    .map((entry) => entry.stopId)
    .filter((stopId) => {
      if (selected.has(stopId)) return false;
      selected.add(stopId);
      const execution = state.stopExecutions[stopId];
      return (
        stopId !== state.currentStopId &&
        execution?.status === 'pending' &&
        execution.scheduledDayId === state.executionDayId
      );
    });
}

/** The same successor authority used by actual advancement and presentation. */
export function nextExecutionStopId(
  trip: Pick<Trip, 'days'>,
  state: RouteOrderState,
): StopId | undefined {
  return (
    eligibleWaitingDoNowStopIds(state)[0] ??
    remainingEligibleNormalStopIds(trip, state)[0]
  );
}

/** Current, waiting FIFO, then canonical remaining normal work, each once. */
export function projectedExecutionStopIds(
  trip: Pick<Trip, 'days'>,
  state: RouteOrderState,
): StopId[] {
  if (!state.currentStopId || !state.executionDayId) return [];
  const currentExecution = state.stopExecutions[state.currentStopId];
  if (
    currentExecution?.status !== 'pending' ||
    currentExecution.scheduledDayId !== state.executionDayId
  ) {
    return [];
  }

  return [
    state.currentStopId,
    ...eligibleWaitingDoNowStopIds(state),
    ...remainingEligibleNormalStopIds(trip, state),
  ];
}
