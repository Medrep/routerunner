import type { Trip } from '../../domain/index.ts';
import { copenhagenTrip } from './copenhagen.ts';
import { krakowField06Trip } from './krakow.ts';

export const TRIP_QUERY_PARAMETER = 'trip';

export interface SelectableTrip {
  readonly label: string;
  readonly trip: Trip;
}

export const selectableTrips: readonly SelectableTrip[] = [
  { label: 'Copenhagen', trip: copenhagenTrip },
  { label: 'Kraków field test', trip: krakowField06Trip },
];

export function selectTrip(tripId: string | null | undefined): Trip {
  return (
    selectableTrips.find(({ trip }) => trip.id === tripId)?.trip ??
    copenhagenTrip
  );
}

export function selectTripFromSearch(search: string): Trip {
  return selectTrip(new URLSearchParams(search).get(TRIP_QUERY_PARAMETER));
}

export function tripSelectionHref(tripId: string): string {
  return `?${TRIP_QUERY_PARAMETER}=${encodeURIComponent(tripId)}`;
}
