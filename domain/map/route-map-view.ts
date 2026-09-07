import {
  nextEligiblePendingStopId,
  orderedDayPlan,
} from '../execution/transitions.ts';
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
  order: number;
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

export interface RouteMapView {
  stops: RouteMapStopView[];
  legs: RouteMapLegView[];
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
  if (!day) {
    return {
      stops: [],
      legs: [],
      userLocation,
      routePresentation: 'unavailable',
    };
  }

  const nextStopId = nextEligiblePendingStopId(trip, execution);
  const stopById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  const orderedPlan = orderedDayPlan(day);
  const stops = orderedPlan.flatMap<RouteMapStopView>((item) => {
    const stop = stopById.get(item.stopId);
    const stopExecution = execution.stopExecutions[item.stopId];
    if (!stop || !stopExecution) return [];

    let status: RouteMapStopStatus = 'future';
    if (execution.currentStopId === item.stopId) status = 'current';
    else if (nextStopId === item.stopId) status = 'next';
    else if (stopExecution.status === 'completed') status = 'completed';
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
        order: item.order,
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
    userLocation,
    routePresentation: representations.has('schematic-endpoints')
      ? 'schematic-endpoints'
      : representations.has('prepared-geometry')
        ? 'prepared-geometry'
        : 'unavailable',
  };
}
