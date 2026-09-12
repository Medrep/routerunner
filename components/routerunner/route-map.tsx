'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import type {
  ForegroundLocationState,
  RouteMapCoordinate,
  RouteMapView,
  StopId,
} from '@/domain';
import { deriveRouteMapMarkerDetail, mapboxTokenState } from '@/domain';
import {
  activateRouteMapLocation,
  clearRouteMapOverlays,
  createRouteMapOverlayState,
  type RouteMapOverlayState,
  syncRouteMapPlannedOverlays,
  syncRouteMapUserMarker,
} from './route-map-location';

type MapOverlayState = RouteMapOverlayState<MapboxMap, Marker, Marker, Marker>;

function locationCaption(location: ForegroundLocationState): string {
  switch (location.status) {
    case 'inactive':
      return 'Location starts with an active day';
    case 'locating':
      return 'Finding your foreground location…';
    case 'available':
      return `Location current · ±${Math.round(location.coordinates.accuracy)} m`;
    case 'stale':
      return `Location outdated · last accuracy ±${Math.round(location.coordinates.accuracy)} m`;
    case 'denied':
      return 'Location denied · planned map remains available';
    case 'unavailable':
      return 'Location unavailable · planned map remains available';
    case 'timeout':
      return 'Location timed out · planned map remains available';
    case 'unsupported':
      return 'Location unavailable in this browser';
    case 'error':
      return 'Location error · planned map remains available';
  }
}

function fitCoordinates(
  mapbox: typeof import('mapbox-gl'),
  map: MapboxMap,
  coordinates: readonly RouteMapCoordinate[],
  full: boolean,
): void {
  if (coordinates.length === 0) return;
  if (coordinates.length === 1) {
    const point = coordinates[0];
    map.jumpTo({ center: [point.longitude, point.latitude], zoom: 13 });
    return;
  }
  const bounds = new mapbox.default.LngLatBounds();
  for (const point of coordinates) {
    bounds.extend([point.longitude, point.latitude]);
  }
  map.fitBounds(bounds, {
    padding: full ? 80 : 48,
    duration: 0,
    maxZoom: 14,
  });
}

export default function RouteMap({
  view,
  location,
  onRetryLocation,
  full = false,
}: {
  view: RouteMapView;
  location: ForegroundLocationState;
  onRetryLocation: () => void;
  full?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const moduleRef = useRef<typeof import('mapbox-gl') | null>(null);
  const overlayStateRef = useRef<MapOverlayState | null>(null);
  const viewRef = useRef(view);
  const locationRef = useRef(location);
  const fittedCoordinatesKeyRef = useRef<string | undefined>(undefined);
  const [selectedStopId, setSelectedStopId] = useState<StopId>();
  const [runtimeError, setRuntimeError] = useState<string>();
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const selectedStop = deriveRouteMapMarkerDetail(view, selectedStopId);

  function updatePlannedOverlays(map: MapboxMap): void {
    const mapbox = moduleRef.current;
    const state = overlayStateRef.current;
    if (!mapbox || !map.isStyleLoaded() || !state || state.map !== map) return;

    syncRouteMapPlannedOverlays(state, viewRef.current, {
      createViaMarker: (targetMap, point) => {
        const viaElement = document.createElement('div');
        viaElement.className = 'mapbox-via-marker';
        viaElement.setAttribute('aria-label', 'Via planned route');
        viaElement.title = 'Via planned route';
        const viaLabel = document.createElement('span');
        viaLabel.textContent = 'Via';
        viaElement.appendChild(viaLabel);
        return new mapbox.default.Marker({
          element: viaElement,
          anchor: 'center',
        })
          .setLngLat([point.longitude, point.latitude])
          .addTo(targetMap);
      },
      createStopMarker: (targetMap, stop) => {
        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.className = `mapbox-stop-marker ${stop.status} ${stop.markerRole} ${stop.kind === 'sightseeing' ? stop.priority : ''}`;
        markerButton.textContent = stop.markerLabel;
        markerButton.setAttribute(
          'aria-label',
          `${stop.markerLabel}. ${stop.name}, ${stop.status}, ${stop.semanticLabel}`,
        );
        markerButton.addEventListener('click', () =>
          setSelectedStopId(stop.stopId),
        );
        return new mapbox.default.Marker({
          element: markerButton,
          anchor: 'center',
        })
          .setLngLat([stop.longitude, stop.latitude])
          .addTo(targetMap);
      },
    });
  }

  function updateUserMarker(map: MapboxMap): void {
    const mapbox = moduleRef.current;
    const state = overlayStateRef.current;
    if (!mapbox || !map.isStyleLoaded() || !state || state.map !== map) return;
    syncRouteMapUserMarker(
      state,
      locationRef.current,
      (targetMap, longitudeLatitude) => {
        const userElement = document.createElement('div');
        userElement.className = 'mapbox-user-marker';
        userElement.setAttribute('role', 'img');
        userElement.setAttribute(
          'aria-label',
          'Your current foreground location',
        );
        return new mapbox.default.Marker({
          element: userElement,
          anchor: 'center',
        })
          .setLngLat(longitudeLatitude)
          .addTo(targetMap);
      },
    );
  }

  function handleLocationControl(): void {
    activateRouteMapLocation(
      location,
      overlayStateRef.current?.map ?? null,
      onRetryLocation,
    );
  }

  useEffect(() => {
    if (
      mapboxTokenState(token) === 'missing' ||
      !containerRef.current ||
      mapRef.current
    ) {
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let overlayState: MapOverlayState | undefined;
    void import('mapbox-gl')
      .then((mapbox) => {
        if (cancelled || !containerRef.current) return;
        moduleRef.current = mapbox;
        mapbox.default.accessToken = token!;
        const firstPoint = viewRef.current.initialBoundsCoordinates[0];
        const map = new mapbox.default.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: firstPoint
            ? [firstPoint.longitude, firstPoint.latitude]
            : [0, 0],
          zoom: firstPoint ? 12.7 : 1,
          attributionControl: true,
        });
        mapRef.current = map;
        overlayState = createRouteMapOverlayState<
          MapboxMap,
          Marker,
          Marker,
          Marker
        >(map);
        overlayStateRef.current = overlayState;
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(containerRef.current);
        }
        resizeFrame = window.requestAnimationFrame(() => map.resize());
        if (full) map.addControl(new mapbox.default.NavigationControl());
        map.on('load', () => {
          map.resize();
          updatePlannedOverlays(map);
          updateUserMarker(map);
          fitCoordinates(
            mapbox,
            map,
            viewRef.current.initialBoundsCoordinates,
            full,
          );
          fittedCoordinatesKeyRef.current = JSON.stringify(
            viewRef.current.initialBoundsCoordinates,
          );
        });
        map.on('error', () => {
          setRuntimeError(
            'Map unavailable offline. Your itinerary and progress still work.',
          );
        });
      })
      .catch(() =>
        setRuntimeError(
          'Map unavailable offline. Your itinerary and progress still work.',
        ),
      );

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
      if (overlayState) clearRouteMapOverlays(overlayState);
      if (overlayStateRef.current === overlayState) {
        overlayStateRef.current = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
      moduleRef.current = null;
    };
  }, [full, token]);

  useEffect(() => {
    viewRef.current = view;
    const map = mapRef.current;
    if (map) {
      updatePlannedOverlays(map);
      const coordinatesKey = JSON.stringify(view.initialBoundsCoordinates);
      if (
        moduleRef.current &&
        map.isStyleLoaded() &&
        fittedCoordinatesKeyRef.current !== coordinatesKey
      ) {
        fitCoordinates(
          moduleRef.current,
          map,
          view.initialBoundsCoordinates,
          full,
        );
        fittedCoordinatesKeyRef.current = coordinatesKey;
      }
    }
  }, [full, view]);

  useEffect(() => {
    locationRef.current = location;
    const map = mapRef.current;
    if (map) updateUserMarker(map);
  }, [location]);

  const retryable =
    location.status === 'stale' ||
    location.status === 'denied' ||
    location.status === 'unavailable' ||
    location.status === 'timeout' ||
    location.status === 'error';

  if (mapboxTokenState(token) === 'missing') {
    return (
      <div className={`route-map map-unavailable ${full ? 'is-full' : ''}`}>
        <div>
          <strong>Map unavailable</strong>
          <span>
            Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to show the geographic map.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`route-map mapbox-route-map ${full ? 'is-full' : ''}`}>
      <div
        ref={containerRef}
        className="mapbox-canvas"
        aria-label="Route map"
      />
      <div className="map-topline">
        <span>
          <i /> Route overview
        </span>
        <span className="north">↑ N</span>
      </div>
      {location.status !== 'inactive' && (
        <div className="map-location-panel">
          <output aria-live="polite">{locationCaption(location)}</output>
          {location.status !== 'unsupported' && (
            <button
              type="button"
              aria-label="Show my location"
              disabled={location.status === 'locating'}
              onClick={handleLocationControl}
            >
              {location.status === 'available'
                ? 'My location'
                : location.status === 'locating'
                  ? 'Locating…'
                  : retryable
                    ? 'Retry location'
                    : 'My location'}
            </button>
          )}
        </div>
      )}
      {!full && !selectedStop && (
        <output className="map-caption">
          <span>Itinerary stop overview · not turn-by-turn routing</span>
          {runtimeError && <span>{runtimeError}</span>}
        </output>
      )}
      {selectedStop && (
        <aside
          className="map-marker-detail route-map-detail"
          aria-live="polite"
        >
          <div>
            <span>
              {selectedStop.markerLabel} · {selectedStop.semanticLabel}
            </span>
            <strong>{selectedStop.name}</strong>
            {(selectedStop.plannedStartTime ||
              selectedStop.status !== 'future') && (
              <small>
                {selectedStop.plannedStartTime && (
                  <>Planned {selectedStop.plannedStartTime}</>
                )}
                {selectedStop.plannedStartTime &&
                  selectedStop.status !== 'future' && <> · </>}
                {selectedStop.status !== 'future' && selectedStop.status}
              </small>
            )}
          </div>
          <button
            type="button"
            aria-label="Close map stop information"
            onClick={() => setSelectedStopId(undefined)}
          >
            <X size={18} />
          </button>
        </aside>
      )}
      {full && runtimeError && (
        <p className="whole-trip-map-error">{runtimeError}</p>
      )}
    </div>
  );
}
