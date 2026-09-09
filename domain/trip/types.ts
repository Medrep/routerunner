declare const stopIdBrand: unique symbol;
declare const stopVisitPlanItemIdBrand: unique symbol;
declare const postDayDestinationIdBrand: unique symbol;

/** Opaque sightseeing-stop identity within a trip. */
export type StopId = string & { readonly [stopIdBrand]: 'StopId' };

/** Opaque identity scoped to one Stop's prepared internal visit plan. */
export type StopVisitPlanItemId = string & {
  readonly [stopVisitPlanItemIdBrand]: 'StopVisitPlanItemId';
};

/** Opaque identity for static post-day navigation data. */
export type PostDayDestinationId = string & {
  readonly [postDayDestinationIdBrand]: 'PostDayDestinationId';
};

/** Explicit raw-data boundary; fixture validation belongs to RR-MVP-01. */
export function createStopId(value: string): StopId {
  return value as StopId;
}

/** Explicit raw-data boundary for a parent-scoped internal plan identity. */
export function createStopVisitPlanItemId(value: string): StopVisitPlanItemId {
  return value as StopVisitPlanItemId;
}

/** Explicit raw-data boundary; fixture validation belongs to RR-MVP-01. */
export function createPostDayDestinationId(
  value: string,
): PostDayDestinationId {
  return value as PostDayDestinationId;
}

export type StopPriority = 'must' | 'normal' | 'optional';

/** Immutable prepared content for one ordered place or task inside a Stop. */
export interface StopVisitPlanItem {
  readonly id: StopVisitPlanItemId;
  readonly order: number;
  readonly name: string;
  readonly visitBrief?: string;
  readonly highlights?: readonly string[];
}

/** Static internal execution structure; it is not global Trip execution state. */
export interface StopVisitPlan {
  readonly items: readonly StopVisitPlanItem[];
}

export type TimeConstraint =
  | {
      type: 'fixed_time';
      start: string;
      end?: never;
    }
  | {
      type: 'time_window';
      start: string;
      end?: string;
    };

export interface Stop {
  id: StopId;
  name: string;
  shortName?: string;
  /** Prepared field context explaining why to stop and what to know or do. */
  visitBrief?: string;
  /** Prepared, ordered things to notice, check, or do at the stop. */
  highlights?: readonly string[];
  /** Prepared ordered places or tasks inside this one global Stop. */
  visitPlan?: StopVisitPlan;
  latitude: number;
  longitude: number;
  priority: StopPriority;
  canSkip: boolean;
  plannedVisitMinutes: number;
  note?: string;
  timeConstraint?: TimeConstraint;
}

export interface DayPlanItem {
  stopId: StopId;
  order: number;
}

export type PostDayNavigationTarget =
  | { latitude: number; longitude: number }
  | { address: string };

/** Static navigation data after sightseeing; never a sightseeing stop. */
export interface PostDayDestination {
  id: PostDayDestinationId;
  name: string;
  navigationTarget: PostDayNavigationTarget;
  targetArrivalTime?: string;
  plannedTravelMinutes?: number;
  mode?: 'walk' | 'transit' | 'ferry' | 'other';
}

export interface TripDay {
  id: string;
  date: string;
  title?: string;
  plannedStartTime?: string;
  hardEndTime?: string;
  plan: DayPlanItem[];
  postDayDestination?: PostDayDestination;
}

export type TravelMode = 'walk' | 'transit' | 'ferry' | 'other';

export interface LegGeometryPoint {
  latitude: number;
  longitude: number;
}

/** Ordered path-shaping data for an external navigator; never a Trip Stop. */
export type NavigationWaypoint = Readonly<LegGeometryPoint>;

export interface Leg {
  id: string;
  fromStopId: StopId;
  toStopId: StopId;
  mode: TravelMode;
  plannedDurationMinutes?: number;
  distanceMeters?: number;
  instruction?: string;
  geometry?: LegGeometryPoint[];
  navigationWaypoints?: readonly NavigationWaypoint[];
}

export interface BufferBelowRule {
  id: string;
  type: 'buffer_below';
  thresholdMinutes: number;
  action: {
    type: 'recommend_skip';
    stopId: StopId;
  };
}

export type ExecutionRule = BufferBelowRule;

/** Static itinerary data. Runtime execution belongs to TripExecutionState. */
export interface Trip {
  id: string;
  title: string;
  city?: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  stops: Stop[];
  days: TripDay[];
  legs?: Leg[];
  rules?: ExecutionRule[];
}
