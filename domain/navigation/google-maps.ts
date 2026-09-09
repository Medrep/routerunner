import { persistExecutionTransition } from '../execution/persistence.ts';
import { startDay } from '../execution/transitions.ts';
import {
  resolveCurrentInboundLeg,
  resolveWaypointSafeInboundLeg,
} from './waypoint-safe-inbound-leg.ts';
import type {
  ExecutionStorage,
  PersistExecutionTransitionResult,
} from '../execution/persistence.ts';
import type { TravelMode, Trip } from '../trip/types.ts';
import type { TripExecutionState } from '../execution/types.ts';

export type GoogleMapsTravelMode = 'walking' | 'transit';

export interface GoogleMapsDestination {
  latitude: number;
  longitude: number;
}

export function googleMapsTravelMode(
  mode: TravelMode | undefined,
): GoogleMapsTravelMode | undefined {
  if (mode === 'walk') return 'walking';
  if (mode === 'transit' || mode === 'ferry') return 'transit';
  return undefined;
}

export function buildGoogleMapsNavigationUrl(
  destination: GoogleMapsDestination,
  travelMode?: GoogleMapsTravelMode,
  waypoints: readonly GoogleMapsDestination[] = [],
): string {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set(
    'destination',
    `${destination.latitude},${destination.longitude}`,
  );
  if (travelMode) url.searchParams.set('travelmode', travelMode);
  if (waypoints.length > 0) {
    url.searchParams.set(
      'waypoints',
      waypoints
        .map((waypoint) => `${waypoint.latitude},${waypoint.longitude}`)
        .join('|'),
    );
  }
  return url.toString();
}

export function currentGoogleMapsNavigationUrl(
  trip: Trip,
  state: TripExecutionState,
): string | undefined {
  if (!state.currentStopId) return undefined;
  const current = trip.stops.find((stop) => stop.id === state.currentStopId);
  if (!current) return undefined;
  const inboundLeg = resolveCurrentInboundLeg(trip, state);
  const waypointSafeInboundLeg = resolveWaypointSafeInboundLeg(trip, state);
  return buildGoogleMapsNavigationUrl(
    { latitude: current.latitude, longitude: current.longitude },
    googleMapsTravelMode(inboundLeg?.mode),
    waypointSafeInboundLeg?.navigationWaypoints,
  );
}

export type StartAndNavigateResult =
  | {
      status: 'rejected';
      result: Extract<PersistExecutionTransitionResult, { status: 'rejected' }>;
    }
  | {
      status: 'accepted';
      result: Extract<PersistExecutionTransitionResult, { status: 'accepted' }>;
      navigationUrl?: string;
    };

export function startDayAndBuildNavigation(
  trip: Trip,
  state: TripExecutionState,
  dayId: string,
  now: string,
  storage?: ExecutionStorage,
): StartAndNavigateResult {
  const result = persistExecutionTransition(
    trip,
    state,
    startDay(trip, state, dayId, now),
    storage,
  );
  if (result.status === 'rejected') return { status: 'rejected', result };
  return {
    status: 'accepted',
    result,
    navigationUrl: currentGoogleMapsNavigationUrl(trip, result.state),
  };
}
