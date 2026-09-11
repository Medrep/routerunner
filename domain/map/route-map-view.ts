import {
  isWaitingDoNow,
  orderedDayPlan,
} from '../execution/execution-order.ts';
import { nextEligiblePendingStopId } from '../execution/transitions.ts';
import { resolveWaypointSafeInboundLeg } from '../navigation/waypoint-safe-inbound-leg.ts';
import {
  isSightseeingStop,
  stopKind,
  stopMarkerLabel,
  stopSemanticLabel,
} from '../trip/stop-semantics.ts';
import type { ForegroundCoordinates } from '../location/foreground-location.ts';
import type {
  LogisticsRole,
  StopId,
  StopKind,
  StopPriority,
  TravelMode,
  Trip,
} from '../trip/types.ts';
import type { TripExecutionState } from '../execution/types.ts';

export type RouteMapStopStatus =
  | 'completed'
  | 'current'
  | 'next'
  | 'queued'
  | 'skipped'
  | 'saved'
  | 'future';

export interface RouteMapStopView {
  stopId: StopId;
  name: string;
  latitude: number;
  longitude: number;
  /** Canonical execution position; presentation numbering is separate. */
  itineraryPosition: number;
  sightseeingPosition?: number;
  markerLabel: string;
  kind: StopKind;
  logisticsRole?: LogisticsRole;
  semanticLabel: string;
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
  const plannedStopIds = new Set(orderedPlan.map((item) => item.stopId));
  const executionOverrideStopIds = includeExecutionContext
    ? execution.doNowQueue
        .map((entry) => entry.stopId)
        .filter((stopId) => !plannedStopIds.has(stopId))
    : [];
  let sightseeingPosition = 0;
  const presentedStops = [
    ...orderedPlan.map((item) => item.stopId),
    ...executionOverrideStopIds,
  ].map((stopId, index) => {
    const stop = stopById.get(stopId);
    const position =
      stop && isSightseeingStop(stop) ? ++sightseeingPosition : undefined;
    return {
      stopId,
      itineraryPosition: index + 1,
      ...(position === undefined ? {} : { sightseeingPosition: position }),
    };
  });
  const stops = presentedStops.flatMap<RouteMapStopView>((item) => {
    const stop = stopById.get(item.stopId);
    const stopExecution = execution.stopExecutions[item.stopId];
    if (!stop || !stopExecution) return [];

    let status: RouteMapStopStatus = 'future';
    if (includeExecutionContext && execution.currentStopId === item.stopId) {
      status = 'current';
    } else if (isWaitingDoNow(execution, item.stopId)) {
      status = 'queued';
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
        itineraryPosition: item.itineraryPosition,
        ...(item.sightseeingPosition === undefined
          ? {}
          : { sightseeingPosition: item.sightseeingPosition }),
        markerLabel: stopMarkerLabel(stop, item.sightseeingPosition),
        kind: stopKind(stop),
        ...(stop.logisticsRole === undefined
          ? {}
          : { logisticsRole: stop.logisticsRole }),
        semanticLabel: stopSemanticLabel(stop),
        priority: stop.priority,
        canSkip: stop.canSkip,
        status,
      },
    ];
  });

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
