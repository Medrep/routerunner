'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import type {
  WholeTripMapCoordinate,
  WholeTripMapView,
  WholeTripMarkerView,
} from '@/domain';
import { mapboxTokenState } from '@/domain';

function removeMarkers(markers: Map<string, Marker>): void {
  for (const marker of markers.values()) marker.remove();
  markers.clear();
}

function markerKey(marker: WholeTripMarkerView): string {
  return marker.kind === 'stop'
    ? `stop-${marker.dayId}-${marker.stopId}`
    : `post-day-${marker.dayId}-${marker.destinationId}`;
}

function fitCoordinates(
  mapbox: typeof import('mapbox-gl'),
  map: MapboxMap,
  coordinates: readonly WholeTripMapCoordinate[],
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
  map.fitBounds(bounds, { padding: 72, duration: 0, maxZoom: 14 });
}

export default function WholeTripMap({ view }: { view: WholeTripMapView }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const moduleRef = useRef<typeof import('mapbox-gl') | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const routeIdsRef = useRef<string[]>([]);
  const viewRef = useRef(view);
  const [selectedMarkerKey, setSelectedMarkerKey] = useState<string>();
  const [runtimeError, setRuntimeError] = useState<string>();
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const selectedMarker = view.markers.find(
    (marker) => markerKey(marker) === selectedMarkerKey,
  );

  function removeRoutes(map: MapboxMap): void {
    for (const id of routeIdsRef.current) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    routeIdsRef.current = [];
  }

  function updateOverlays(map: MapboxMap): void {
    const mapbox = moduleRef.current;
    if (!mapbox || !map.isStyleLoaded()) return;

    removeRoutes(map);
    for (const group of viewRef.current.routeGroups) {
      if (group.legs.length === 0) continue;
      const id = `whole-trip-route-${group.dayNumber}`;
      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: group.legs.map((leg) => ({
            type: 'Feature',
            properties: { legId: leg.legId, mode: leg.mode },
            geometry: { type: 'LineString', coordinates: leg.coordinates },
          })),
        },
      });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': group.dayStyle.color,
          'line-width': 4,
          'line-opacity': 0.72,
        },
      });
      routeIdsRef.current.push(id);
    }

    removeMarkers(markersRef.current);
    for (const markerView of viewRef.current.markers) {
      const markerButton = document.createElement('button');
      markerButton.type = 'button';
      markerButton.className = `whole-trip-stop-marker ${markerView.markerRole} ${markerView.kind === 'stop' ? markerView.status : ''}`;
      markerButton.style.setProperty('--day-color', markerView.dayStyle.color);
      markerButton.textContent = markerView.markerLabel;
      markerButton.setAttribute(
        'aria-label',
        `${markerView.markerLabel}. ${markerView.name}. ${markerView.semanticLabel}.`,
      );
      markerButton.addEventListener('click', () =>
        setSelectedMarkerKey(markerKey(markerView)),
      );
      const marker = new mapbox.default.Marker({
        element: markerButton,
        anchor: 'center',
      })
        .setLngLat([markerView.longitude, markerView.latitude])
        .addTo(map);
      markersRef.current.set(markerKey(markerView), marker);
    }
  }

  function showAllPoints(): void {
    const mapbox = moduleRef.current;
    const map = mapRef.current;
    if (mapbox && map) {
      fitCoordinates(mapbox, map, viewRef.current.allBoundsCoordinates);
    }
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
          zoom: firstPoint ? 12 : 1,
          attributionControl: true,
        });
        mapRef.current = map;
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(containerRef.current);
        }
        map.addControl(new mapbox.default.NavigationControl(), 'bottom-right');
        map.on('load', () => {
          map.resize();
          updateOverlays(map);
          fitCoordinates(mapbox, map, viewRef.current.initialBoundsCoordinates);
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

    const currentMarkers = markersRef.current;
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      removeMarkers(currentMarkers);
      if (mapRef.current) removeRoutes(mapRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      moduleRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    viewRef.current = view;
    const map = mapRef.current;
    if (map) updateOverlays(map);
  }, [view]);

  if (mapboxTokenState(token) === 'missing') {
    return (
      <div className="whole-trip-map map-unavailable">
        <div>
          <strong>Trip map unavailable</strong>
          <span>
            Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to show the whole-trip map.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="whole-trip-map mapbox-route-map">
      <div
        ref={containerRef}
        className="mapbox-canvas"
        aria-label="Whole trip map"
      />
      <div className="whole-trip-map-toolbar">
        <div className="whole-trip-map-title">
          <strong>Whole trip</strong>
          <button type="button" onClick={showAllPoints}>
            All points
          </button>
        </div>
        <div className="whole-trip-map-legend" aria-label="Planned day legend">
          {view.days.map((day) => (
            <div key={day.dayId}>
              <i style={{ backgroundColor: day.style.color }} />
              <span>
                <strong>{day.label}</strong> — {day.title}
                {day.postDayDestinationName && (
                  <small>After: {day.postDayDestinationName}</small>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      {selectedMarker && (
        <aside className="map-marker-detail" aria-live="polite">
          <div>
            <span style={{ color: selectedMarker.dayStyle.color }}>
              {selectedMarker.dayLabel} · {selectedMarker.markerLabel} ·{' '}
              {selectedMarker.semanticLabel}
            </span>
            <strong>{selectedMarker.name}</strong>
            {selectedMarker.kind === 'stop' &&
              selectedMarker.status !== 'planned' && (
                <small>Status: {selectedMarker.status}</small>
              )}
            {selectedMarker.kind === 'post-day' &&
              selectedMarker.targetArrivalTime && (
                <small>Target arrival {selectedMarker.targetArrivalTime}</small>
              )}
          </div>
          <button
            type="button"
            aria-label="Close map stop information"
            onClick={() => setSelectedMarkerKey(undefined)}
          >
            <X size={18} />
          </button>
        </aside>
      )}
      {runtimeError && <p className="whole-trip-map-error">{runtimeError}</p>}
    </div>
  );
}
