import type { ForegroundLocationState } from '@/domain';

type LongitudeLatitude = [longitude: number, latitude: number];

export interface RouteMapUserMarker {
  setLngLat(coordinates: LongitudeLatitude): unknown;
  remove(): unknown;
}

export interface RouteMapLocationCamera {
  getZoom(): number;
  easeTo(options: {
    center: LongitudeLatitude;
    zoom: number;
    duration: number;
  }): unknown;
}

export function syncRouteMapUserMarker<
  MapType,
  MarkerType extends RouteMapUserMarker,
>(
  map: MapType,
  location: ForegroundLocationState,
  marker: MarkerType | null,
  createMarker: (map: MapType, coordinates: LongitudeLatitude) => MarkerType,
): MarkerType | null {
  if (location.status !== 'available') {
    marker?.remove();
    return null;
  }
  const coordinates: LongitudeLatitude = [
    location.coordinates.longitude,
    location.coordinates.latitude,
  ];
  if (marker) {
    marker.setLngLat(coordinates);
    return marker;
  }
  return createMarker(map, coordinates);
}

export function activateRouteMapLocation(
  location: ForegroundLocationState,
  map: RouteMapLocationCamera | null,
  retry: () => void,
): void {
  if (location.status === 'available' && map) {
    map.easeTo({
      center: [location.coordinates.longitude, location.coordinates.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: 500,
    });
    return;
  }
  retry();
}
