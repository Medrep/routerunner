'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import type {
  ForegroundLocationState,
  RouteMapLegView,
  RouteMapView,
  StopId,
} from '@/domain';
import { mapboxTokenState } from '@/domain';

const ROUTE_SOURCE_ID = 'routerunner-prepared-legs';
const ROUTE_LAYER_IDS = [
  'routerunner-walk-legs',
  'routerunner-transit-legs',
  'routerunner-ferry-legs',
] as const;

function routeGeoJson(legs: RouteMapLegView[]) {
  return {
    type: 'FeatureCollection',
    features: legs.map((leg) => ({
      type: 'Feature',
      properties: {
        legId: leg.legId,
        mode: leg.mode,
        representation: leg.representation,
      },
      geometry: { type: 'LineString', coordinates: leg.coordinates },
    })),
  };
}

function removeMarkers(markers: Map<string, Marker>): void {
  for (const marker of markers.values()) marker.remove();
  markers.clear();
}

function locationCaption(location: ForegroundLocationState): string {
  switch (location.status) {
    case 'inactive':
      return 'Location starts with an active day';
    case 'locating':
      return 'Finding your foreground location…';
    case 'available':
      return `Location available · ±${Math.round(location.coordinates.accuracy)} m`;
    case 'denied':
      return 'Location denied · planned map remains available';
    case 'unavailable':
      return 'Location unavailable · planned map remains available';
    case 'timeout':
      return 'Location timed out · planned map remains available';
    case 'error':
      return 'Location error · planned map remains available';
  }
}

export default function RouteMap({
  view,
  location,
  onStop,
  full = false,
}: {
  view: RouteMapView;
  location: ForegroundLocationState;
  onStop: (stopId: StopId) => void;
  full?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const moduleRef = useRef<typeof import('mapbox-gl') | null>(null);
  const stopMarkersRef = useRef(new Map<string, Marker>());
  const userMarkerRef = useRef<Marker | null>(null);
  const viewRef = useRef(view);
  const onStopRef = useRef(onStop);
  const [runtimeError, setRuntimeError] = useState<string>();
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  function updateOverlays(map: MapboxMap): void {
    const mapbox = moduleRef.current;
    if (!mapbox || !map.isStyleLoaded()) return;

    const routeSource = map.getSource(ROUTE_SOURCE_ID);
    if (routeSource?.type === 'geojson') {
      routeSource.setData(routeGeoJson(viewRef.current.legs));
    }

    removeMarkers(stopMarkersRef.current);
    for (const stop of viewRef.current.stops) {
      const markerButton = document.createElement('button');
      markerButton.type = 'button';
      markerButton.className = `mapbox-stop-marker ${stop.status} ${stop.priority}`;
      markerButton.dataset.label = stop.name;
      markerButton.textContent =
        stop.status === 'completed'
          ? '✓'
          : stop.status === 'skipped'
            ? '−'
            : stop.status === 'saved'
              ? '◇'
              : String(stop.order);
      markerButton.setAttribute(
        'aria-label',
        `${stop.order}. ${stop.name}, ${stop.status}, ${stop.priority}`,
      );
      markerButton.title = stop.name;
      markerButton.addEventListener('click', () =>
        onStopRef.current(stop.stopId),
      );
      const marker = new mapbox.default.Marker({
        element: markerButton,
        anchor: 'center',
      })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(map);
      stopMarkersRef.current.set(String(stop.stopId), marker);
    }

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (viewRef.current.userLocation) {
      const userElement = document.createElement('div');
      userElement.className = 'mapbox-user-marker';
      userElement.setAttribute('role', 'img');
      userElement.setAttribute(
        'aria-label',
        'Your current foreground location',
      );
      userMarkerRef.current = new mapbox.default.Marker({
        element: userElement,
        anchor: 'center',
      })
        .setLngLat([
          viewRef.current.userLocation.longitude,
          viewRef.current.userLocation.latitude,
        ])
        .addTo(map);
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
    const stopMarkers = stopMarkersRef.current;
    void import('mapbox-gl')
      .then((mapbox) => {
        if (cancelled || !containerRef.current) return;
        moduleRef.current = mapbox;
        mapbox.default.accessToken = token!;
        const firstStop = viewRef.current.stops[0];
        const map = new mapbox.default.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: firstStop
            ? [firstStop.longitude, firstStop.latitude]
            : [0, 0],
          zoom: firstStop ? 12.7 : 1,
          attributionControl: true,
        });
        mapRef.current = map;
        if (full) map.addControl(new mapbox.default.NavigationControl());
        map.on('load', () => {
          map.addSource(ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: routeGeoJson(viewRef.current.legs),
          });
          const routeLayers = [
            {
              id: ROUTE_LAYER_IDS[0],
              mode: 'walk',
              color: '#176b50',
              dash: [1, 2],
            },
            {
              id: ROUTE_LAYER_IDS[1],
              mode: 'transit',
              color: '#596f67',
              dash: [4, 2],
            },
            {
              id: ROUTE_LAYER_IDS[2],
              mode: 'ferry',
              color: '#327895',
              dash: [2, 2],
            },
          ] as const;
          for (const layer of routeLayers) {
            map.addLayer({
              id: layer.id,
              type: 'line',
              source: ROUTE_SOURCE_ID,
              filter: ['==', ['get', 'mode'], layer.mode],
              paint: {
                'line-color': layer.color,
                'line-width': 3,
                'line-dasharray': [...layer.dash],
              },
            });
          }
          updateOverlays(map);
          if (viewRef.current.stops.length > 1) {
            const bounds = new mapbox.default.LngLatBounds();
            for (const stop of viewRef.current.stops) {
              bounds.extend([stop.longitude, stop.latitude]);
            }
            map.fitBounds(bounds, { padding: full ? 80 : 48, duration: 0 });
          }
        });
        map.on('error', () => {
          setRuntimeError('Map tiles are temporarily unavailable.');
        });
      })
      .catch(() => setRuntimeError('Mapbox could not be initialized.'));

    return () => {
      cancelled = true;
      removeMarkers(stopMarkers);
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      moduleRef.current = null;
    };
  }, [full, token]);

  useEffect(() => {
    viewRef.current = view;
    onStopRef.current = onStop;
    const map = mapRef.current;
    if (map) updateOverlays(map);
  }, [onStop, view]);

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
      <output className="map-caption">
        <span>{locationCaption(location)}</span>
        <span>
          {view.routePresentation === 'schematic-endpoints'
            ? 'Prepared schematic connections · not live routing'
            : view.routePresentation === 'prepared-geometry'
              ? 'Prepared route geometry · not live routing'
              : 'Prepared route geometry unavailable'}
        </span>
        {runtimeError && <span>{runtimeError}</span>}
      </output>
    </div>
  );
}
