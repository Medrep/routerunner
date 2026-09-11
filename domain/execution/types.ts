import type { StopId } from '../trip/types.ts';

export type StopExecutionStatus = 'pending' | 'completed' | 'skipped';

/** Stop runtime state. Current is deliberately not represented here. */
export interface StopExecution {
  stopId: StopId;
  status: StopExecutionStatus;
  scheduledDayId: string | null;
  completedRecordedAt?: string;
  completedOnDayId?: string;
}

export interface DoNowQueueEntry {
  stopId: StopId;
  /** Exact planning context restored if an unfinished override is cancelled. */
  returnScheduledDayId: string | null;
}

export type KnownOrUnknownDuration =
  | {
      status: 'known';
      minutes: number;
    }
  | {
      status: 'unknown';
      reason?: 'unresolved' | 'unavailable';
    };

/** Existing persistence timestamp convention: canonical UTC ISO instant. */
export function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

/** Runtime guard for the persisted KnownOrUnknownDuration union. */
export function isKnownOrUnknownDuration(
  value: unknown,
): value is KnownOrUnknownDuration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const duration = value as Record<string, unknown>;
  if (duration.status === 'known') {
    return (
      typeof duration.minutes === 'number' &&
      Number.isFinite(duration.minutes) &&
      duration.minutes >= 0 &&
      duration.reason === undefined
    );
  }
  return (
    duration.status === 'unknown' &&
    duration.minutes === undefined &&
    (duration.reason === undefined ||
      duration.reason === 'unresolved' ||
      duration.reason === 'unavailable')
  );
}

export interface CurrentInboundTravel {
  fromStopId: StopId | null;
  toStopId: StopId;
  duration: KnownOrUnknownDuration;
}

export interface RuleAcknowledgement {
  ruleId: string;
  executionDayId: string;
  severity: 'SCHEDULE_TIGHT' | 'DEADLINE_AT_RISK';
  acknowledgedAt: string;
}

type ExecutionEventBase<TType extends string> = {
  /** Version of the bounded event payload contract, independent of storage. */
  version: 1;
  type: TType;
  recordedAt: string;
  executionDayId: string;
};

type StopExecutionEvent<TType extends string> = ExecutionEventBase<TType> & {
  stopId: StopId;
};

type DecisionExecutionEvent<TType extends string> =
  ExecutionEventBase<TType> & {
    ruleId: string;
    severity: 'SCHEDULE_TIGHT' | 'DEADLINE_AT_RISK';
    targetStopId: StopId;
  };

/**
 * Persisted, append-only local execution history. Array order is canonical;
 * events deliberately have no separate identity in the local MVP.
 */
export type ExecutionEvent =
  | ExecutionEventBase<'day_started'>
  | StopExecutionEvent<'stop_completed'>
  | StopExecutionEvent<'stop_skipped'>
  | StopExecutionEvent<'stop_saved_for_later'>
  | (StopExecutionEvent<'stop_do_now'> & {
      returnScheduledDayId: string | null;
    })
  | (StopExecutionEvent<'stop_do_now_cancelled'> & {
      restoredScheduledDayId: string | null;
    })
  | StopExecutionEvent<'stop_already_visited'>
  | DecisionExecutionEvent<'decision_shown'>
  | DecisionExecutionEvent<'decision_accepted'>
  | DecisionExecutionEvent<'decision_rejected'>
  | ExecutionEventBase<'day_completed'>
  | ExecutionEventBase<'day_reopened'>
  | ExecutionEventBase<'day_ended'>;

/** Trip-owned runtime state; a viewed day is intentionally absent. */
export interface TripExecutionState {
  tripId: string;
  executionDayId?: string;
  executionDayStartedAt?: string;
  currentStopId?: StopId;
  currentStepStartedAt?: string;
  currentInboundTravel?: CurrentInboundTravel;
  stopExecutions: Record<StopId, StopExecution>;
  /**
   * Ordered Do Now execution/provenance ledger. The head is active provenance
   * only when it identifies Current; every remaining entry is waiting FIFO.
   */
  doNowQueue: DoNowQueueEntry[];
  /** Day IDs are unique; ordering is not execution ownership. */
  completedDayIds: string[];
  ruleAcknowledgements: RuleAcknowledgement[];
  eventLog: ExecutionEvent[];
  lastUpdatedAt: string;
}
