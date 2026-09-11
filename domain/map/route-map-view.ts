import {
  nextEligiblePendingStopId,
  orderedDayPlan,
} from '../execution/transitions.ts';
import { resolveWaypointSafeInboundLeg } from '../navigation/waypoint-safe-inbound-leg.ts';
import type { ForegroundCoordinates } from '../location/foreground-location.ts';
import type { StopId, StopPriority, TravelMode, Trip } from '../trip/types.ts';
import type { TripExecutionState } from '../execution/types.ts';

export type RouteMapStopStatus =
  | 'completed'
  | 'current'
  | 'next'
  | 'skipped'
  | 'saved'
  | 'future';

export interface RouteMapStopView {
  stopId: StopId;
  name: string;
  latitude: number;
  longitude: number;
  itineraryPosition: number;
  priority: StopPriority;
  canSkip: boolean;
  status: RouteMapStopStatus;
}

export interface RouteMapLegView {
  legId: string;
  fromStopId: StopId;
  toStopId: StopId;
  mode: TravelMode;
  coordinates: Array<[longitude: number, latitude: number]>;
  representation: 'prepared-geometry' | 'schematic-endpoints';
}

export interface RouteMapNavigationViaPointView {
  readonly longitude: number;
  readonly latitude: number;
}

export interface RouteMapView {
  stops: RouteMapStopView[];
  legs: RouteMapLegView[];
  navigationViaPoints: readonly RouteMapNavigationViaPointView[];
  userLocation?: ForegroundCoordinates;
  routePresentation:
    | 'prepared-geometry'
    | 'schematic-endpoints'
    | 'unavailable';
}

export function mapboxTokenState(
  token: string | undefined,
): 'available' | 'missing' {
  return token?.trim() ? 'available' : 'missing';
}

export function deriveRouteMapView(
  trip: Trip,
  execution: TripExecutionState,
  userLocation?: ForegroundCoordinates,
): RouteMapView {
  const day =
    trip.days.find((candidate) => candidate.id === execution.executionDayId) ??
    trip.days[0];
  return deriveDayRouteMapView(trip, execution, day, true, userLocation);
}

/**
 * Shows one original planned day without applying Current/Next or active
 * inbound navigation context from another execution day.
 */
export function deriveDayPreviewRouteMapView(
  trip: Trip,
  execution: TripExecutionState,
  viewedDayId: string,
  userLocation?: ForegroundCoordinates,
): RouteMapView {
  const day = trip.days.find((candidate) => candidate.id === viewedDayId);
  return deriveDayRouteMapView(trip, execution, day, false, userLocation);
}

function deriveDayRouteMapView(
  trip: Trip,
  execution: TripExecutionState,
  day: Trip['days'][number] | undefined,
  includeExecutionContext: boolean,
  userLocation?: ForegroundCoordinates,
): RouteMapView {
  if (!day) {
    return {
      stops: [],
      legs: [],
      navigationViaPoints: [],
      userLocation,
      routePresentation: 'unavailable',
    };
  }

  const nextStopId = includeExecutionContext
    ? nextEligiblePendingStopId(trip, execution)
    : undefined;
  const stopById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  const waypointSafeInboundLeg = includeExecutionContext
    ? resolveWaypointSafeInboundLeg(trip, execution)
    : undefined;
  const navigationViaPoints: readonly RouteMapNavigationViaPointView[] =
    waypointSafeInboundLeg?.navigationWaypoints?.map((point) => ({
      longitude: point.longitude,
      latitude: point.latitude,
    })) ?? [];
  const orderedPlan = orderedDayPlan(day);
  const stops = orderedPlan.flatMap<RouteMapStopView>((item, index) => {
    const stop = stopById.get(item.stopId);
    const stopExecution = execution.stopExecutions[item.stopId];
    if (!stop || !stopExecution) return [];

    let status: RouteMapStopStatus = 'future';
    if (includeExecutionContext && execution.currentStopId === item.stopId) {
      status = 'current';
    } else if (includeExecutionContext && nextStopId === item.stopId) {
      status = 'next';
    } else if (stopExecution.status === 'completed') status = 'completed';
    else if (stopExecution.status === 'skipped') status = 'skipped';
    else if (
      stopExecution.status === 'pending' &&
      stopExecution.scheduledDayId === null
    ) {
      status = 'saved';
    }

    return [
      {
        stopId: stop.id,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        itineraryPosition: index + 1,
        priority: stop.priority,
        canSkip: stop.canSkip,
        status,
      },
    ];
  });

  const plannedStopIds = new Set(orderedPlan.map((item) => item.stopId));
  const orderByStopId = new Map(
    orderedPlan.map((item, index) => [item.stopId, index]),
  );
  const legs = (trip.legs ?? []).flatMap<RouteMapLegView>((leg) => {
    const fromOrder = orderByStopId.get(leg.fromStopId);
    const toOrder = orderByStopId.get(leg.toStopId);
    if (
      !plannedStopIds.has(leg.fromStopId) ||
      !plannedStopIds.has(leg.toStopId) ||
      fromOrder === undefined ||
      toOrder !== fromOrder + 1
    ) {
      return [];
    }
    const from = stopById.get(leg.fromStopId);
    const to = stopById.get(leg.toStopId);
    if (!from || !to) return [];
    const representation = leg.geometry?.length
      ? 'prepared-geometry'
      : 'schematic-endpoints';
    return [
      {
        legId: leg.id,
        fromStopId: leg.fromStopId,
        toStopId: leg.toStopId,
        mode: leg.mode,
        representation,
        coordinates: leg.geometry?.length
          ? leg.geometry.map((point) => [point.longitude, point.latitude])
          : [
              [from.longitude, from.latitude],
              [to.longitude, to.latitude],
            ],
      },
    ];
  });
  const representations = new Set(legs.map((leg) => leg.representation));

  return {
    stops,
    legs,
    navigationViaPoints,
    userLocation,
    routePresentation: representations.has('schematic-endpoints')
      ? 'schematic-endpoints'
      : representations.has('prepared-geometry')
        ? 'prepared-geometry'
        : 'unavailable',
  };
}
