import type { StopId, Trip } from '../trip/types.ts';
import type {
  CurrentInboundTravel,
  DoNowQueueEntry,
  ExecutionEvent,
  KnownOrUnknownDuration,
  RuleAcknowledgement,
  StopExecution,
  StopExecutionStatus,
  TripExecutionState,
} from './types.ts';
import { isCanonicalIsoTimestamp, isKnownOrUnknownDuration } from './types.ts';
import { createInitialTripExecutionState } from './create-execution-state.ts';
import { hasCoherentExecutionStateRelationships } from './transitions.ts';
import type { TransitionError, TransitionResult } from './transitions.ts';

export const EXECUTION_STATE_SCHEMA_VERSION = 3;
const PREVIOUS_EXECUTION_STATE_SCHEMA_VERSION = 2;
const LEGACY_EXECUTION_STATE_SCHEMA_VERSION = 1;

export interface ExecutionStateEnvelope {
  version: typeof EXECUTION_STATE_SCHEMA_VERSION;
  tripId: string;
  savedAt: string;
  state: TripExecutionState;
}

export type ExecutionStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export type DeserializeExecutionStateResult =
  | { status: 'restored'; state: TripExecutionState; savedAt: string }
  | { status: 'invalid'; reason: string };

export type LoadExecutionStateResult =
  | DeserializeExecutionStateResult
  | { status: 'empty' }
  | { status: 'unavailable'; operation: 'read'; reason: string };

export type SaveExecutionStateResult =
  | { status: 'saved'; savedAt: string }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; operation: 'write'; reason: string };

export type ClearExecutionStateResult =
  | { status: 'cleared' }
  | { status: 'unavailable'; operation: 'clear'; reason: string };

export interface RestoredOrFreshExecutionState {
  state: TripExecutionState;
  loadResult: LoadExecutionStateResult;
}

export type PersistExecutionTransitionResult =
  | {
      status: 'accepted';
      state: TripExecutionState;
      persistence: SaveExecutionStateResult;
    }
  | {
      status: 'rejected';
      state: TripExecutionState;
      error: TransitionError;
    };

export function executionStorageKey(tripId: string): string {
  return `routerunner:execution:${tripId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function canonicalDayId(
  value: unknown,
  dayIds: ReadonlySet<string>,
): string | undefined {
  return typeof value === 'string' && dayIds.has(value) ? value : undefined;
}

function durationFromUnknown(
  value: unknown,
): KnownOrUnknownDuration | undefined {
  if (!isKnownOrUnknownDuration(value)) return undefined;

  if (value.status === 'known') {
    return { status: 'known', minutes: value.minutes };
  }
  return value.reason === undefined
    ? { status: 'unknown' }
    : { status: 'unknown', reason: value.reason };
}

function inboundTravelFromUnknown(
  value: unknown,
  stopIds: ReadonlyMap<string, StopId>,
): CurrentInboundTravel | undefined {
  if (!isRecord(value)) return undefined;

  const fromStopId =
    value.fromStopId === null
      ? null
      : typeof value.fromStopId === 'string'
        ? stopIds.get(value.fromStopId)
        : undefined;
  const toStopId =
    typeof value.toStopId === 'string'
      ? stopIds.get(value.toStopId)
      : undefined;
  const duration = durationFromUnknown(value.duration);

  if (fromStopId === undefined || !toStopId || !duration) return undefined;

  return { fromStopId, toStopId, duration };
}

function stopExecutionFromUnknown(
  value: unknown,
  expectedStopId: StopId,
  dayIds: ReadonlySet<string>,
): StopExecution | undefined {
  if (!isRecord(value) || value.stopId !== expectedStopId) return undefined;

  const status = value.status;
  if (status !== 'pending' && status !== 'completed' && status !== 'skipped') {
    return undefined;
  }

  const rawScheduledDayId = value.scheduledDayId;
  const scheduledDayId =
    rawScheduledDayId === null
      ? null
      : canonicalDayId(rawScheduledDayId, dayIds);
  if (scheduledDayId === undefined) return undefined;

  const completedRecordedAt = optionalValue(value, 'completedRecordedAt');
  if (
    completedRecordedAt !== undefined &&
    !isCanonicalIsoTimestamp(completedRecordedAt)
  ) {
    return undefined;
  }

  const rawCompletedOnDayId = optionalValue(value, 'completedOnDayId');
  const completedOnDayId =
    rawCompletedOnDayId === undefined
      ? undefined
      : canonicalDayId(rawCompletedOnDayId, dayIds);
  if (rawCompletedOnDayId !== undefined && completedOnDayId === undefined) {
    return undefined;
  }

  const execution: StopExecution = {
    stopId: expectedStopId,
    status: status as StopExecutionStatus,
    scheduledDayId,
  };
  if (completedRecordedAt !== undefined) {
    execution.completedRecordedAt = completedRecordedAt;
  }
  if (completedOnDayId !== undefined) {
    execution.completedOnDayId = completedOnDayId;
  }
  return execution;
}

function executionEventFromUnknown(
  value: unknown,
  stopIds: ReadonlyMap<string, StopId>,
  dayIds: ReadonlySet<string>,
  rulesById: ReadonlyMap<string, NonNullable<Trip['rules']>[number]>,
): ExecutionEvent | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.type !== 'string' ||
    !isCanonicalIsoTimestamp(value.recordedAt) ||
    typeof value.executionDayId !== 'string' ||
    !dayIds.has(value.executionDayId)
  ) {
    return undefined;
  }

  const baseKeys = ['version', 'type', 'recordedAt', 'executionDayId'];
  const base = {
    version: 1 as const,
    recordedAt: value.recordedAt,
    executionDayId: value.executionDayId,
  };
  if (
    value.type === 'day_started' ||
    value.type === 'day_completed' ||
    value.type === 'day_reopened' ||
    value.type === 'day_ended'
  ) {
    return hasExactKeys(value, baseKeys)
      ? { ...base, type: value.type }
      : undefined;
  }

  if (
    value.type === 'decision_shown' ||
    value.type === 'decision_accepted' ||
    value.type === 'decision_rejected'
  ) {
    const rule =
      typeof value.ruleId === 'string'
        ? rulesById.get(value.ruleId)
        : undefined;
    const targetStopId =
      typeof value.targetStopId === 'string'
        ? stopIds.get(value.targetStopId)
        : undefined;
    if (
      !rule ||
      rule.dayId !== value.executionDayId ||
      !targetStopId ||
      rule.action.stopId !== targetStopId ||
      (value.severity !== 'SCHEDULE_TIGHT' &&
        value.severity !== 'DEADLINE_AT_RISK') ||
      !hasExactKeys(value, [...baseKeys, 'ruleId', 'severity', 'targetStopId'])
    ) {
      return undefined;
    }
    return {
      ...base,
      type: value.type,
      ruleId: rule.id,
      severity: value.severity,
      targetStopId,
    };
  }

  const stopId =
    typeof value.stopId === 'string' ? stopIds.get(value.stopId) : undefined;
  if (!stopId) return undefined;
  const stopKeys = [...baseKeys, 'stopId'];
  if (
    value.type === 'stop_completed' ||
    value.type === 'stop_skipped' ||
    value.type === 'stop_saved_for_later' ||
    value.type === 'stop_already_visited'
  ) {
    return hasExactKeys(value, stopKeys)
      ? { ...base, type: value.type, stopId }
      : undefined;
  }
  if (value.type === 'stop_do_now') {
    const returnScheduledDayId =
      value.returnScheduledDayId === null
        ? null
        : canonicalDayId(value.returnScheduledDayId, dayIds);
    return returnScheduledDayId !== undefined &&
      hasExactKeys(value, [...stopKeys, 'returnScheduledDayId'])
      ? { ...base, type: value.type, stopId, returnScheduledDayId }
      : undefined;
  }
  if (value.type === 'stop_do_now_cancelled') {
    const restoredScheduledDayId =
      value.restoredScheduledDayId === null
        ? null
        : canonicalDayId(value.restoredScheduledDayId, dayIds);
    return restoredScheduledDayId !== undefined &&
      hasExactKeys(value, [...stopKeys, 'restoredScheduledDayId'])
      ? { ...base, type: value.type, stopId, restoredScheduledDayId }
      : undefined;
  }

  return undefined;
}

function stateFromUnknown(
  value: unknown,
  trip: Trip,
  migrateWithoutEventLog = false,
): TripExecutionState | undefined {
  if (!isRecord(value) || value.tripId !== trip.id) return undefined;

  const stopIds = new Map(trip.stops.map((stop) => [String(stop.id), stop.id]));
  const dayIds = new Set(trip.days.map((day) => day.id));

  if (!isRecord(value.stopExecutions)) return undefined;
  const executionKeys = Object.keys(value.stopExecutions);
  if (
    executionKeys.length !== stopIds.size ||
    executionKeys.some((stopId) => !stopIds.has(stopId))
  ) {
    return undefined;
  }

  const stopExecutions = {} as Record<StopId, StopExecution>;
  for (const [rawStopId, stopId] of stopIds) {
    const execution = stopExecutionFromUnknown(
      value.stopExecutions[rawStopId],
      stopId,
      dayIds,
    );
    if (!execution) return undefined;
    stopExecutions[stopId] = execution;
  }

  const rawExecutionDayId = optionalValue(value, 'executionDayId');
  const executionDayId =
    rawExecutionDayId === undefined
      ? undefined
      : canonicalDayId(rawExecutionDayId, dayIds);
  if (rawExecutionDayId !== undefined && executionDayId === undefined) {
    return undefined;
  }

  const rawCurrentStopId = optionalValue(value, 'currentStopId');
  const currentStopId =
    rawCurrentStopId === undefined || typeof rawCurrentStopId !== 'string'
      ? undefined
      : stopIds.get(rawCurrentStopId);
  if (rawCurrentStopId !== undefined && currentStopId === undefined) {
    return undefined;
  }

  const executionDayStartedAt = optionalValue(value, 'executionDayStartedAt');
  const currentStepStartedAt = optionalValue(value, 'currentStepStartedAt');
  if (
    (executionDayStartedAt !== undefined &&
      !isCanonicalIsoTimestamp(executionDayStartedAt)) ||
    (currentStepStartedAt !== undefined &&
      !isCanonicalIsoTimestamp(currentStepStartedAt))
  ) {
    return undefined;
  }

  const rawInboundTravel = optionalValue(value, 'currentInboundTravel');
  const currentInboundTravel =
    rawInboundTravel === undefined
      ? undefined
      : inboundTravelFromUnknown(rawInboundTravel, stopIds);
  if (rawInboundTravel !== undefined && currentInboundTravel === undefined) {
    return undefined;
  }

  if (!Array.isArray(value.doNowQueue)) return undefined;
  const doNowQueue: DoNowQueueEntry[] = [];
  const queuedStopIds = new Set<StopId>();
  for (const rawEntry of value.doNowQueue) {
    if (!isRecord(rawEntry) || typeof rawEntry.stopId !== 'string') {
      return undefined;
    }
    const stopId = stopIds.get(rawEntry.stopId);
    const rawReturnDayId = rawEntry.returnScheduledDayId;
    const returnScheduledDayId =
      rawReturnDayId === null ? null : canonicalDayId(rawReturnDayId, dayIds);
    if (
      !stopId ||
      returnScheduledDayId === undefined ||
      queuedStopIds.has(stopId) ||
      executionDayId === undefined ||
      stopExecutions[stopId]?.status !== 'pending' ||
      stopExecutions[stopId]?.scheduledDayId !== executionDayId
    ) {
      return undefined;
    }
    queuedStopIds.add(stopId);
    doNowQueue.push({ stopId, returnScheduledDayId });
  }

  if (!Array.isArray(value.completedDayIds)) return undefined;
  const completedDayIds: string[] = [];
  for (const rawDayId of value.completedDayIds) {
    const dayId = canonicalDayId(rawDayId, dayIds);
    if (!dayId || completedDayIds.includes(dayId)) return undefined;
    completedDayIds.push(dayId);
  }

  if (!Array.isArray(value.ruleAcknowledgements)) return undefined;
  const rulesById = new Map((trip.rules ?? []).map((rule) => [rule.id, rule]));
  const ruleAcknowledgements: RuleAcknowledgement[] = [];
  const acknowledgementKeys = new Set<string>();
  for (const rawAcknowledgement of value.ruleAcknowledgements) {
    if (
      !isRecord(rawAcknowledgement) ||
      typeof rawAcknowledgement.ruleId !== 'string' ||
      rawAcknowledgement.ruleId.length === 0 ||
      !rulesById.has(rawAcknowledgement.ruleId) ||
      typeof rawAcknowledgement.executionDayId !== 'string' ||
      !dayIds.has(rawAcknowledgement.executionDayId) ||
      rulesById.get(rawAcknowledgement.ruleId)?.dayId !==
        rawAcknowledgement.executionDayId ||
      (rawAcknowledgement.severity !== 'SCHEDULE_TIGHT' &&
        rawAcknowledgement.severity !== 'DEADLINE_AT_RISK') ||
      !isCanonicalIsoTimestamp(rawAcknowledgement.acknowledgedAt)
    ) {
      return undefined;
    }
    const key = `${rawAcknowledgement.ruleId}\u0000${rawAcknowledgement.executionDayId}\u0000${rawAcknowledgement.severity}`;
    if (acknowledgementKeys.has(key)) return undefined;
    acknowledgementKeys.add(key);
    ruleAcknowledgements.push({
      ruleId: rawAcknowledgement.ruleId,
      executionDayId: rawAcknowledgement.executionDayId,
      severity: rawAcknowledgement.severity,
      acknowledgedAt: rawAcknowledgement.acknowledgedAt,
    });
  }

  const eventLog: ExecutionEvent[] = [];
  if (!migrateWithoutEventLog) {
    if (!Array.isArray(value.eventLog)) return undefined;
    let priorRecordedAt = Number.NEGATIVE_INFINITY;
    for (const rawEvent of value.eventLog) {
      const event = executionEventFromUnknown(
        rawEvent,
        stopIds,
        dayIds,
        rulesById,
      );
      if (!event) return undefined;
      const recordedAt = new Date(event.recordedAt).valueOf();
      if (recordedAt < priorRecordedAt) return undefined;
      priorRecordedAt = recordedAt;
      eventLog.push(event);
    }
  }

  if (!isCanonicalIsoTimestamp(value.lastUpdatedAt)) return undefined;
  if (
    eventLog.length > 0 &&
    new Date(eventLog.at(-1)!.recordedAt).valueOf() >
      new Date(value.lastUpdatedAt).valueOf()
  ) {
    return undefined;
  }

  const state: TripExecutionState = {
    tripId: trip.id,
    stopExecutions,
    doNowQueue,
    completedDayIds,
    ruleAcknowledgements,
    eventLog,
    lastUpdatedAt: value.lastUpdatedAt,
  };
  if (executionDayId !== undefined) state.executionDayId = executionDayId;
  if (executionDayStartedAt !== undefined) {
    state.executionDayStartedAt = executionDayStartedAt;
  }
  if (currentStopId !== undefined) state.currentStopId = currentStopId;
  if (currentStepStartedAt !== undefined) {
    state.currentStepStartedAt = currentStepStartedAt;
  }
  if (currentInboundTravel !== undefined) {
    state.currentInboundTravel = currentInboundTravel;
  }

  return hasCoherentExecutionStateRelationships(trip, state)
    ? state
    : undefined;
}

function unavailableReason(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Browser storage is unavailable.';
}

function defaultStorage(): ExecutionStorage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function deserializeExecutionState(
  serialized: string,
  trip: Trip,
): DeserializeExecutionStateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {
      status: 'invalid',
      reason: 'Persisted execution JSON is malformed.',
    };
  }

  if (!isRecord(parsed)) {
    return {
      status: 'invalid',
      reason: 'Persisted execution envelope is invalid.',
    };
  }
  if (
    parsed.version !== EXECUTION_STATE_SCHEMA_VERSION &&
    parsed.version !== PREVIOUS_EXECUTION_STATE_SCHEMA_VERSION &&
    parsed.version !== LEGACY_EXECUTION_STATE_SCHEMA_VERSION
  ) {
    return {
      status: 'invalid',
      reason: 'Persisted execution version is unsupported.',
    };
  }
  if (parsed.tripId !== trip.id) {
    return {
      status: 'invalid',
      reason: 'Persisted execution trip does not match.',
    };
  }
  if (!isCanonicalIsoTimestamp(parsed.savedAt)) {
    return {
      status: 'invalid',
      reason: 'Persisted execution savedAt is invalid.',
    };
  }

  if (parsed.version === LEGACY_EXECUTION_STATE_SCHEMA_VERSION) {
    if (
      !isRecord(parsed.state) ||
      !Array.isArray(parsed.state.ruleAcknowledgements) ||
      parsed.state.ruleAcknowledgements.length > 0
    ) {
      return {
        status: 'invalid',
        reason:
          'Legacy rule acknowledgements cannot be migrated without inventing day or severity.',
      };
    }
  }

  const state = stateFromUnknown(
    parsed.state,
    trip,
    parsed.version !== EXECUTION_STATE_SCHEMA_VERSION,
  );
  if (!state) {
    return {
      status: 'invalid',
      reason: 'Persisted execution state is invalid.',
    };
  }

  return { status: 'restored', state, savedAt: parsed.savedAt };
}

export function loadExecutionState(
  trip: Trip,
  storage: ExecutionStorage | undefined = defaultStorage(),
): LoadExecutionStateResult {
  if (!storage) {
    return {
      status: 'unavailable',
      operation: 'read',
      reason: 'Browser storage is unavailable.',
    };
  }

  let serialized: string | null;
  try {
    serialized = storage.getItem(executionStorageKey(trip.id));
  } catch (error) {
    return {
      status: 'unavailable',
      operation: 'read',
      reason: unavailableReason(error),
    };
  }

  return serialized === null
    ? { status: 'empty' }
    : deserializeExecutionState(serialized, trip);
}

export function saveExecutionState(
  trip: Trip,
  state: TripExecutionState,
  savedAt: string,
  storage: ExecutionStorage | undefined = defaultStorage(),
): SaveExecutionStateResult {
  if (
    state.tripId !== trip.id ||
    !isCanonicalIsoTimestamp(savedAt) ||
    stateFromUnknown(state, trip) === undefined
  ) {
    return {
      status: 'invalid',
      reason: 'Execution state cannot be persisted.',
    };
  }
  if (!storage) {
    return {
      status: 'unavailable',
      operation: 'write',
      reason: 'Browser storage is unavailable.',
    };
  }

  const envelope: ExecutionStateEnvelope = {
    version: EXECUTION_STATE_SCHEMA_VERSION,
    tripId: trip.id,
    savedAt,
    state,
  };

  try {
    storage.setItem(executionStorageKey(trip.id), JSON.stringify(envelope));
    return { status: 'saved', savedAt };
  } catch (error) {
    return {
      status: 'unavailable',
      operation: 'write',
      reason: unavailableReason(error),
    };
  }
}

export function clearExecutionState(
  trip: Pick<Trip, 'id'>,
  storage: ExecutionStorage | undefined = defaultStorage(),
): ClearExecutionStateResult {
  if (!storage) {
    return {
      status: 'unavailable',
      operation: 'clear',
      reason: 'Browser storage is unavailable.',
    };
  }

  try {
    storage.removeItem(executionStorageKey(trip.id));
    return { status: 'cleared' };
  } catch (error) {
    return {
      status: 'unavailable',
      operation: 'clear',
      reason: unavailableReason(error),
    };
  }
}

export function restoreOrCreateExecutionState(
  trip: Trip,
  now: string,
  storage: ExecutionStorage | undefined = defaultStorage(),
): RestoredOrFreshExecutionState {
  const loadResult = loadExecutionState(trip, storage);
  return {
    state:
      loadResult.status === 'restored'
        ? loadResult.state
        : createInitialTripExecutionState(trip, now),
    loadResult,
  };
}

export function persistExecutionTransition(
  trip: Trip,
  currentState: TripExecutionState,
  transition: TransitionResult,
  storage: ExecutionStorage | undefined = defaultStorage(),
): PersistExecutionTransitionResult {
  if (!transition.ok) {
    return {
      status: 'rejected',
      state: currentState,
      error: transition.error,
    };
  }

  return {
    status: 'accepted',
    state: transition.state,
    persistence: saveExecutionState(
      trip,
      transition.state,
      transition.state.lastUpdatedAt,
      storage,
    ),
  };
}
