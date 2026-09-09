declare const stopIdBrand: unique symbol;
declare const postDayDestinationIdBrand: unique symbol;

/** Opaque sightseeing-stop identity within a trip. */
export type StopId = string & { readonly [stopIdBrand]: 'StopId' };

/** Opaque identity for static post-day navigation data. */
export type PostDayDestinationId = string & {
  readonly [postDayDestinationIdBrand]: 'PostDayDestinationId';
};

/** Explicit raw-data boundary; fixture validation belongs to RR-MVP-01. */
export function createStopId(value: string): StopId {
  return value as StopId;
}

/** Explicit raw-data boundary; fixture validation belongs to RR-MVP-01. */
export function createPostDayDestinationId(
  value: string,
): PostDayDestinationId {
  return value as PostDayDestinationId;
}

export type StopPriority = 'must' | 'normal' | 'optional';

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
