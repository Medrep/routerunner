'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import type { ForegroundLocationState, RouteMapView, StopId } from '@/domain';
import { mapboxTokenState } from '@/domain';

function removeMarkers<Key>(markers: Map<Key, Marker>): void {
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
  const viaMarkersRef = useRef(new Map<number, Marker>());
  const userMarkerRef = useRef<Marker | null>(null);
  const viewRef = useRef(view);
  const onStopRef = useRef(onStop);
  const [runtimeError, setRuntimeError] = useState<string>();
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  function updateOverlays(map: MapboxMap): void {
    const mapbox = moduleRef.current;
    if (!mapbox || !map.isStyleLoaded()) return;

    removeMarkers(viaMarkersRef.current);
    for (const [
      index,
      point,
    ] of viewRef.current.navigationViaPoints.entries()) {
      const viaElement = document.createElement('div');
      viaElement.className = 'mapbox-via-marker';
      viaElement.setAttribute('aria-label', 'Via planned route');
      viaElement.title = 'Via planned route';
      const viaLabel = document.createElement('span');
      viaLabel.textContent = 'Via';
      viaElement.appendChild(viaLabel);
      const marker = new mapbox.default.Marker({
        element: viaElement,
        anchor: 'center',
      })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
      viaMarkersRef.current.set(index, marker);
    }

    removeMarkers(stopMarkersRef.current);
    for (const stop of viewRef.current.stops) {
      const markerButton = document.createElement('button');
      markerButton.type = 'button';
      markerButton.className = `mapbox-stop-marker ${stop.status} ${stop.priority}`;
      markerButton.dataset.label = stop.name;
      markerButton.textContent = String(stop.itineraryPosition);
      markerButton.setAttribute(
        'aria-label',
        `${stop.itineraryPosition}. ${stop.name}, ${stop.status}, ${stop.priority}`,
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
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    const stopMarkers = stopMarkersRef.current;
    const viaMarkers = viaMarkersRef.current;
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
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(containerRef.current);
        }
        resizeFrame = window.requestAnimationFrame(() => map.resize());
        if (full) map.addControl(new mapbox.default.NavigationControl());
        map.on('load', () => {
          map.resize();
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
      resizeObserver?.disconnect();
      if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
      removeMarkers(stopMarkers);
      removeMarkers(viaMarkers);
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
        <span>Itinerary stop overview · not turn-by-turn routing</span>
        {runtimeError && <span>{runtimeError}</span>}
      </output>
    </div>
  );
}
