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

/** Trip-owned runtime state; a viewed day is intentionally absent. */
export interface TripExecutionState {
  tripId: string;
  executionDayId?: string;
  executionDayStartedAt?: string;
  currentStopId?: StopId;
  currentStepStartedAt?: string;
  currentInboundTravel?: CurrentInboundTravel;
  stopExecutions: Record<StopId, StopExecution>;
  doNowQueue: DoNowQueueEntry[];
  /** Day IDs are unique; ordering is not execution ownership. */
  completedDayIds: string[];
  ruleAcknowledgements: RuleAcknowledgement[];
  lastUpdatedAt: string;
}
