import type { StopId, Trip } from '../trip/types.ts';
import { isTripComplete } from './lifecycle.ts';
import { isActiveDoNowOverride, waitingDoNowQueue } from './execution-order.ts';
import type { TripExecutionState } from './types.ts';

export type StopExecutionRole =
  | 'current'
  | 'current_do_now'
  | 'waiting_do_now'
  | 'pending'
  | 'for_later'
  | 'completed'
  | 'skipped';

export interface StopActionEligibility {
  readonly navigate: boolean;
  readonly done: boolean;
  readonly skip: boolean;
  readonly saveForLater: boolean;
  readonly doNow: boolean;
  readonly cancelDoNow: boolean;
  readonly alreadyVisited: boolean;
}

export interface StopActionModel {
  readonly stopId: StopId;
  readonly role: StopExecutionRole;
  readonly statusLabel: string;
  readonly queuePosition?: number;
  readonly actions: StopActionEligibility;
}

const noActions: StopActionEligibility = {
  navigate: false,
  done: false,
  skip: false,
  saveForLater: false,
  doNow: false,
  cancelDoNow: false,
  alreadyVisited: false,
};

/** One pure authority for Stop role, queue position, and Details actions. */
export function deriveStopActionModel(
  trip: Trip,
  state: TripExecutionState,
  stopId: StopId,
): StopActionModel | undefined {
  const stop = trip.stops.find((candidate) => candidate.id === stopId);
  const execution = state.stopExecutions[stopId];
  if (!stop || !execution) return undefined;

  const waitingIndex = waitingDoNowQueue(state).findIndex(
    (entry) => entry.stopId === stopId,
  );
  const role: StopExecutionRole =
    execution.status === 'completed'
      ? 'completed'
      : execution.status === 'skipped'
        ? 'skipped'
        : state.currentStopId === stopId
          ? isActiveDoNowOverride(state, stopId)
            ? 'current_do_now'
            : 'current'
          : waitingIndex >= 0
            ? 'waiting_do_now'
            : execution.scheduledDayId === null
              ? 'for_later'
              : 'pending';
  const statusLabel =
    role === 'current' || role === 'current_do_now'
      ? 'Current'
      : role === 'waiting_do_now'
        ? 'Queued for now'
        : role === 'for_later'
          ? 'For later'
          : role === 'completed'
            ? 'Visited'
            : role === 'skipped'
              ? 'Skipped'
              : 'Planned';

  if (trip.id !== state.tripId || isTripComplete(trip, state)) {
    return { stopId, role, statusLabel, actions: noActions };
  }
  if (role === 'current' || role === 'current_do_now') {
    return {
      stopId,
      role,
      statusLabel,
      actions: {
        ...noActions,
        navigate: true,
        done: true,
        skip: stop.canSkip,
        saveForLater: true,
      },
    };
  }
  if (role === 'waiting_do_now') {
    return {
      stopId,
      role,
      statusLabel,
      queuePosition: waitingIndex + 1,
      actions: { ...noActions, cancelDoNow: true },
    };
  }

  const canRecordNonCurrent =
    state.executionDayId !== undefined &&
    (role === 'pending' || role === 'for_later');
  return {
    stopId,
    role,
    statusLabel,
    actions: canRecordNonCurrent
      ? { ...noActions, doNow: true, alreadyVisited: true }
      : noActions,
  };
}

export function waitingDoNowActionModels(
  trip: Trip,
  state: TripExecutionState,
): StopActionModel[] {
  return waitingDoNowQueue(state).flatMap((entry) => {
    const model = deriveStopActionModel(trip, state, entry.stopId);
    return model ? [model] : [];
  });
}

export function pendingForLaterActionModels(
  trip: Trip,
  state: TripExecutionState,
): StopActionModel[] {
  return trip.stops.flatMap((stop) => {
    const model = deriveStopActionModel(trip, state, stop.id);
    return model?.role === 'for_later' &&
      (model.actions.doNow || model.actions.alreadyVisited)
      ? [model]
      : [];
  });
}
