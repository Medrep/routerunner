import type {
  ForegroundLocationState,
  RouteMapNavigationViaPointView,
  RouteMapStopView,
} from '@/domain';

type LongitudeLatitude = [longitude: number, latitude: number];

interface RemovableRouteMapMarker {
  remove(): unknown;
}

export interface RouteMapUserMarker extends RemovableRouteMapMarker {
  setLngLat(coordinates: LongitudeLatitude): unknown;
}

export interface RouteMapOverlayState<
  MapType,
  StopMarkerType extends RemovableRouteMapMarker,
  ViaMarkerType extends RemovableRouteMapMarker,
  UserMarkerType extends RouteMapUserMarker,
> {
  readonly map: MapType;
  readonly stopMarkers: Map<string, StopMarkerType>;
  readonly viaMarkers: Map<number, ViaMarkerType>;
  userMarker: UserMarkerType | null;
}

export interface RouteMapLocationCamera {
  getZoom(): number;
  easeTo(options: {
    center: LongitudeLatitude;
    zoom: number;
    duration: number;
  }): unknown;
}

export interface RouteMapLocationControlModel {
  readonly label: 'My location' | 'Locating…' | 'Retry';
  readonly disabled: boolean;
  readonly message?: string;
}

export function routeMapLocationControlModel(
  location: ForegroundLocationState,
): RouteMapLocationControlModel {
  switch (location.status) {
    case 'locating':
      return { label: 'Locating…', disabled: true };
    case 'denied':
      return {
        label: 'Retry',
        disabled: false,
        message: 'Location permission denied',
      };
    case 'timeout':
      return {
        label: 'Retry',
        disabled: false,
        message: 'Location timed out',
      };
    case 'unsupported':
      return {
        label: 'Retry',
        disabled: false,
        message: 'Location unsupported',
      };
    case 'stale':
    case 'unavailable':
    case 'error':
      return {
        label: 'Retry',
        disabled: false,
        message: 'Location unavailable',
      };
    case 'inactive':
    case 'available':
      return { label: 'My location', disabled: false };
  }
}

export function shouldCompleteRequestedLocationRecenter(
  pending: boolean,
  location: ForegroundLocationState,
): boolean {
  return pending && location.status === 'available';
}

export function createRouteMapOverlayState<
  MapType,
  StopMarkerType extends RemovableRouteMapMarker,
  ViaMarkerType extends RemovableRouteMapMarker,
  UserMarkerType extends RouteMapUserMarker,
>(
  map: MapType,
): RouteMapOverlayState<
  MapType,
  StopMarkerType,
  ViaMarkerType,
  UserMarkerType
> {
  return {
    map,
    stopMarkers: new Map(),
    viaMarkers: new Map(),
    userMarker: null,
  };
}

function removeMarkers<Key, MarkerType extends RemovableRouteMapMarker>(
  markers: Map<Key, MarkerType>,
): void {
  for (const marker of markers.values()) marker.remove();
  markers.clear();
}

export function syncRouteMapPlannedOverlays<
  MapType,
  StopMarkerType extends RemovableRouteMapMarker,
  ViaMarkerType extends RemovableRouteMapMarker,
  UserMarkerType extends RouteMapUserMarker,
>(
  state: RouteMapOverlayState<
    MapType,
    StopMarkerType,
    ViaMarkerType,
    UserMarkerType
  >,
  view: {
    readonly stops: readonly RouteMapStopView[];
    readonly navigationViaPoints: readonly RouteMapNavigationViaPointView[];
  },
  factories: {
    createStopMarker(map: MapType, stop: RouteMapStopView): StopMarkerType;
    createViaMarker(
      map: MapType,
      point: RouteMapNavigationViaPointView,
      index: number,
    ): ViaMarkerType;
  },
): void {
  removeMarkers(state.viaMarkers);
  for (const [index, point] of view.navigationViaPoints.entries()) {
    state.viaMarkers.set(
      index,
      factories.createViaMarker(state.map, point, index),
    );
  }

  removeMarkers(state.stopMarkers);
  for (const stop of view.stops) {
    state.stopMarkers.set(
      String(stop.stopId),
      factories.createStopMarker(state.map, stop),
    );
  }
}

export function syncRouteMapUserMarker<
  MapType,
  StopMarkerType extends RemovableRouteMapMarker,
  ViaMarkerType extends RemovableRouteMapMarker,
  UserMarkerType extends RouteMapUserMarker,
>(
  state: RouteMapOverlayState<
    MapType,
    StopMarkerType,
    ViaMarkerType,
    UserMarkerType
  >,
  location: ForegroundLocationState,
  createMarker: (
    map: MapType,
    coordinates: LongitudeLatitude,
  ) => UserMarkerType,
): void {
  if (location.status !== 'available') {
    state.userMarker?.remove();
    state.userMarker = null;
    return;
  }
  const coordinates: LongitudeLatitude = [
    location.coordinates.longitude,
    location.coordinates.latitude,
  ];
  if (state.userMarker) {
    state.userMarker.setLngLat(coordinates);
    return;
  }
  state.userMarker = createMarker(state.map, coordinates);
}

export function clearRouteMapOverlays<
  MapType,
  StopMarkerType extends RemovableRouteMapMarker,
  ViaMarkerType extends RemovableRouteMapMarker,
  UserMarkerType extends RouteMapUserMarker,
>(
  state: RouteMapOverlayState<
    MapType,
    StopMarkerType,
    ViaMarkerType,
    UserMarkerType
  >,
): void {
  removeMarkers(state.stopMarkers);
  removeMarkers(state.viaMarkers);
  state.userMarker?.remove();
  state.userMarker = null;
}

export function activateRouteMapLocation(
  location: ForegroundLocationState,
  map: RouteMapLocationCamera | null,
  retry: () => void,
): void {
  if (location.status === 'available') {
    if (map) {
      map.easeTo({
        center: [location.coordinates.longitude, location.coordinates.latitude],
        zoom: Math.max(map.getZoom(), 14),
        duration: 500,
      });
    }
    return;
  }
  retry();
}
