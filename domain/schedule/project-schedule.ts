import { orderedDayPlan } from '../execution/transitions.ts';
import type { TripExecutionState } from '../execution/types.ts';
import type {
  Stop,
  StopId,
  TimeConstraint,
  Trip,
  TripDay,
} from '../trip/types.ts';

const MINUTE_MS = 60_000;

export type ScheduleHealth = 'ON_PLAN' | 'SCHEDULE_TIGHT' | 'DEADLINE_AT_RISK';

export type ScheduleProjectionUnavailableReason =
  | 'trip_state_mismatch'
  | 'execution_day_missing'
  | 'current_step_anchor_missing'
  | 'current_stop_missing'
  | 'current_inbound_missing'
  | 'current_inbound_unknown'
  | 'required_leg_unknown';

export type ScheduleProjection =
  | {
      status: 'inactive';
      reason: 'not_started' | 'no_remaining_work';
      projectedStopIds: readonly StopId[];
    }
  | {
      status: 'unavailable';
      reason: ScheduleProjectionUnavailableReason;
      projectedStopIds: readonly StopId[];
    }
  | {
      status: 'calculable';
      projectedStopIds: readonly StopId[];
      remainingMinutes: number;
      estimatedFinishAt: string;
      bufferMinutes?: number;
      health?: ScheduleHealth;
    };

function activeProjectedStops(
  trip: Trip,
  state: TripExecutionState,
  day: TripDay,
): Stop[] {
  if (!state.currentStopId) return [];

  const stopsById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  const projected: Stop[] = [];
  const selected = new Set<StopId>();

  const addPending = (stopId: StopId) => {
    if (selected.has(stopId)) return;
    const execution = state.stopExecutions[stopId];
    const stop = stopsById.get(stopId);
    if (!stop || execution?.status !== 'pending') return;
    selected.add(stopId);
    projected.push(stop);
  };

  addPending(state.currentStopId);
  if (projected.length === 0) return [];

  for (const entry of state.doNowQueue) addPending(entry.stopId);

  const orderedPlan = orderedDayPlan(day);
  const currentPlanIndex = orderedPlan.findIndex(
    (item) => item.stopId === state.currentStopId,
  );
  const remainingPlan =
    currentPlanIndex < 0
      ? orderedPlan
      : orderedPlan.slice(currentPlanIndex + 1);
  for (const item of remainingPlan) {
    const execution = state.stopExecutions[item.stopId];
    if (
      execution?.status === 'pending' &&
      execution.scheduledDayId === day.id
    ) {
      addPending(item.stopId);
    }
  }

  return projected;
}

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Resolves validated Trip local date/time metadata to an absolute instant. */
function localDateTimeTimestamp(
  date: string,
  time: string,
  timeZone: string,
): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = desiredAsUtc;

  // Re-resolve the zone offset because it may differ from UTC and across DST.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(timestamp, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desiredAsUtc - actualAsUtc;
    timestamp += correction;
    if (correction === 0) break;
  }

  return timestamp;
}

function waitingMinutes(
  arrivalAt: number,
  constraint: TimeConstraint | undefined,
  day: TripDay,
  timeZone: string,
): number {
  if (!constraint) return 0;
  const startsAt = localDateTimeTimestamp(day.date, constraint.start, timeZone);
  return Math.max(0, (startsAt - arrivalAt) / MINUTE_MS);
}

function hardEndTimestamp(day: TripDay, timeZone: string): number | undefined {
  return day.hardEndTime
    ? localDateTimeTimestamp(day.date, day.hardEndTime, timeZone)
    : undefined;
}

function healthForBuffer(bufferMinutes: number): ScheduleHealth {
  if (bufferMinutes >= 30) return 'ON_PLAN';
  if (bufferMinutes >= 0) return 'SCHEDULE_TIGHT';
  return 'DEADLINE_AT_RISK';
}

/**
 * Derives the active execution projection without mutating or persisting it.
 * `now` is supplied by the caller so elapsed-time behavior stays deterministic.
 */
export function projectSchedule(
  trip: Trip,
  state: TripExecutionState,
  now: string,
): ScheduleProjection {
  if (trip.id !== state.tripId) {
    return {
      status: 'unavailable',
      reason: 'trip_state_mismatch',
      projectedStopIds: [],
    };
  }
  if (!state.executionDayId) {
    return { status: 'inactive', reason: 'not_started', projectedStopIds: [] };
  }

  const day = trip.days.find(
    (candidate) => candidate.id === state.executionDayId,
  );
  if (!day) {
    return {
      status: 'unavailable',
      reason: 'execution_day_missing',
      projectedStopIds: [],
    };
  }

  if (!state.currentStopId) {
    return {
      status: 'inactive',
      reason: 'no_remaining_work',
      projectedStopIds: [],
    };
  }
  const currentExecution = state.stopExecutions[state.currentStopId];
  if (
    !trip.stops.some((stop) => stop.id === state.currentStopId) ||
    currentExecution?.status !== 'pending'
  ) {
    return {
      status: 'unavailable',
      reason: 'current_stop_missing',
      projectedStopIds: [],
    };
  }

  const projectedStops = activeProjectedStops(trip, state, day);
  const projectedStopIds = projectedStops.map((stop) => stop.id);
  if (!state.currentStepStartedAt) {
    return {
      status: 'unavailable',
      reason: 'current_step_anchor_missing',
      projectedStopIds,
    };
  }

  const current = projectedStops[0];
  if (
    !state.currentInboundTravel ||
    state.currentInboundTravel.toStopId !== current.id
  ) {
    return {
      status: 'unavailable',
      reason: 'current_inbound_missing',
      projectedStopIds,
    };
  }
  if (state.currentInboundTravel.duration.status === 'unknown') {
    return {
      status: 'unavailable',
      reason: 'current_inbound_unknown',
      projectedStopIds,
    };
  }

  const nowAt = new Date(now).valueOf();
  const currentStartedAt = new Date(state.currentStepStartedAt).valueOf();
  const currentInboundMinutes = state.currentInboundTravel.duration.minutes;
  const currentArrivalAt = currentStartedAt + currentInboundMinutes * MINUTE_MS;
  const currentWaitingMinutes = waitingMinutes(
    currentArrivalAt,
    current.timeConstraint,
    day,
    trip.timeZone,
  );
  const currentBudgetMinutes =
    currentInboundMinutes + currentWaitingMinutes + current.plannedVisitMinutes;
  const elapsedMinutes = Math.max(0, (nowAt - currentStartedAt) / MINUTE_MS);
  let remainingMinutes = Math.max(0, currentBudgetMinutes - elapsedMinutes);
  let cursorAt = nowAt + remainingMinutes * MINUTE_MS;

  for (let index = 1; index < projectedStops.length; index += 1) {
    const previous = projectedStops[index - 1];
    const stop = projectedStops[index];
    const leg = trip.legs?.find(
      (candidate) =>
        candidate.fromStopId === previous.id && candidate.toStopId === stop.id,
    );
    if (leg?.plannedDurationMinutes === undefined) {
      return {
        status: 'unavailable',
        reason: 'required_leg_unknown',
        projectedStopIds,
      };
    }

    const arrivalAt = cursorAt + leg.plannedDurationMinutes * MINUTE_MS;
    const wait = waitingMinutes(
      arrivalAt,
      stop.timeConstraint,
      day,
      trip.timeZone,
    );
    const stepMinutes =
      leg.plannedDurationMinutes + wait + stop.plannedVisitMinutes;
    remainingMinutes += stepMinutes;
    cursorAt += stepMinutes * MINUTE_MS;
  }

  const estimatedFinishAt = new Date(cursorAt).toISOString();
  const deadlineAt = hardEndTimestamp(day, trip.timeZone);
  if (deadlineAt === undefined) {
    return {
      status: 'calculable',
      projectedStopIds,
      remainingMinutes,
      estimatedFinishAt,
    };
  }

  const bufferMinutes = (deadlineAt - cursorAt) / MINUTE_MS;
  return {
    status: 'calculable',
    projectedStopIds,
    remainingMinutes,
    estimatedFinishAt,
    bufferMinutes,
    health: healthForBuffer(bufferMinutes),
  };
}
