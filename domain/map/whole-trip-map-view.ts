import { orderedDayPlan } from '../execution/execution-order.ts';
import {
  isSightseeingStop,
  stopSemanticLabel,
} from '../trip/stop-semantics.ts';
import type {
  LogisticsRole,
  PostDayDestinationId,
  StopId,
  StopPriority,
  TravelMode,
  Trip,
} from '../trip/types.ts';
import type { TripExecutionState } from '../execution/types.ts';

export type WholeTripStopStatus =
  | 'completed'
  | 'current'
  | 'skipped'
  | 'saved'
  | 'planned';

export type WholeTripMarkerRole =
  | 'sightseeing'
  | 'logistics-start'
  | 'logistics-end'
  | 'logistics-transfer'
  | 'post-day';

export interface WholeTripDayStyle {
  readonly key: string;
  readonly color: string;
}

interface WholeTripMarkerBase {
  readonly dayId: string;
  readonly dayNumber: number;
  readonly dayLabel: string;
  readonly dayTitle: string;
  readonly dayStyle: WholeTripDayStyle;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly markerLabel: string;
  readonly markerRole: WholeTripMarkerRole;
}

export interface WholeTripStopMarkerView extends WholeTripMarkerBase {
  readonly kind: 'stop';
  readonly stopId: StopId;
  readonly itineraryPosition: number;
  readonly sightseeingPosition?: number;
  readonly logisticsRole?: LogisticsRole;
  readonly semanticLabel: string;
  readonly priority: StopPriority;
  readonly status: WholeTripStopStatus;
}

export interface WholeTripPostDayMarkerView extends WholeTripMarkerBase {
  readonly kind: 'post-day';
  readonly destinationId: PostDayDestinationId;
  readonly markerRole: 'post-day';
  readonly semanticLabel: 'After sightseeing';
  readonly targetArrivalTime?: string;
}

export type WholeTripMarkerView =
  | WholeTripStopMarkerView
  | WholeTripPostDayMarkerView;

export interface WholeTripRouteLegView {
  readonly legId: string;
  readonly fromStopId: StopId;
  readonly toStopId: StopId;
  readonly mode: TravelMode;
  readonly coordinates: readonly (readonly [
    longitude: number,
    latitude: number,
  ])[];
  readonly navigationViaPoints: readonly (readonly [
    longitude: number,
    latitude: number,
  ])[];
  readonly representation:
    | 'prepared-geometry'
    | 'prepared-waypoints'
    | 'schematic-endpoints';
}

export interface WholeTripRouteGroupView {
  readonly dayId: string;
  readonly dayNumber: number;
  readonly dayLabel: string;
  readonly dayTitle: string;
  readonly dayStyle: WholeTripDayStyle;
  readonly legs: readonly WholeTripRouteLegView[];
}

export interface WholeTripDayLegendView {
  readonly dayId: string;
  readonly dayNumber: number;
  readonly label: string;
  readonly title: string;
  readonly style: WholeTripDayStyle;
  readonly postDayDestinationName?: string;
}

export interface WholeTripMapCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export interface WholeTripMapView {
  readonly days: readonly WholeTripDayLegendView[];
  readonly markers: readonly WholeTripMarkerView[];
  readonly routeGroups: readonly WholeTripRouteGroupView[];
  /** Sightseeing-focused camera points; deliberately excludes post-day outliers. */
  readonly initialBoundsCoordinates: readonly WholeTripMapCoordinate[];
  /** Every rendered point, used by the explicit All points camera control. */
  readonly allBoundsCoordinates: readonly WholeTripMapCoordinate[];
}

const DAY_COLORS = [
  '#176b50',
  '#a36b21',
  '#9e4038',
  '#356c91',
  '#705692',
  '#41706d',
] as const;

/** Stable palette selection from canonical Trip.days order, never persisted. */
export function wholeTripDayStyle(dayIndex: number): WholeTripDayStyle {
  const paletteIndex =
    ((dayIndex % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length;
  return {
    key: `day-style-${paletteIndex + 1}`,
    color: DAY_COLORS[paletteIndex],
  };
}

function stopStatus(
  execution: TripExecutionState,
  stopId: StopId,
): WholeTripStopStatus {
  if (execution.currentStopId === stopId) return 'current';
  const stopExecution = execution.stopExecutions[stopId];
  if (stopExecution?.status === 'completed') return 'completed';
  if (stopExecution?.status === 'skipped') return 'skipped';
  if (
    stopExecution?.status === 'pending' &&
    stopExecution.scheduledDayId === null
  ) {
    return 'saved';
  }
  return 'planned';
}

function markerRole(
  logisticsRole: LogisticsRole | undefined,
): WholeTripMarkerRole {
  if (logisticsRole === 'start') return 'logistics-start';
  if (logisticsRole === 'accommodation') return 'logistics-end';
  return 'logistics-transfer';
}

function logisticsMarkerLabel(
  dayNumber: number,
  logisticsRole: LogisticsRole | undefined,
): string {
  if (logisticsRole === 'start') return `D${dayNumber} START`;
  if (logisticsRole === 'accommodation') return `D${dayNumber} END`;
  return `D${dayNumber} VIA`;
}

function distanceMeters(
  from: WholeTripMapCoordinate,
  to: WholeTripMapCoordinate,
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const fromLatitude = from.latitude * radians;
  const toLatitude = to.latitude * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Keeps the first camera useful when transport endpoints sit far outside the
 * sightseeing area. Outliers remain rendered and available via All points.
 */
function sightseeingFocusedBounds(
  sightseeing: readonly WholeTripMapCoordinate[],
  candidates: readonly WholeTripMapCoordinate[],
): readonly WholeTripMapCoordinate[] {
  if (sightseeing.length === 0) return candidates;
  const centre = sightseeing.reduce(
    (result, point) => ({
      latitude: result.latitude + point.latitude / sightseeing.length,
      longitude: result.longitude + point.longitude / sightseeing.length,
    }),
    { latitude: 0, longitude: 0 },
  );
  const sightseeingRadius = Math.max(
    ...sightseeing.map((point) => distanceMeters(centre, point)),
  );
  const inclusionRadius = Math.max(5_000, sightseeingRadius * 1.75);
  return candidates.filter(
    (point) => distanceMeters(centre, point) <= inclusionRadius,
  );
}

/**
 * Pure, transient presentation over immutable planning data and optional
 * execution decoration. No numbering, style, or open-state data is persisted.
 */
export function deriveWholeTripMapView(
  trip: Trip,
  execution: TripExecutionState,
): WholeTripMapView {
  const stopsById = new Map(trip.stops.map((stop) => [stop.id, stop]));
  const routeGroups: WholeTripRouteGroupView[] = [];
  const markers: WholeTripMarkerView[] = [];
  const days: WholeTripDayLegendView[] = [];

  trip.days.forEach((day, dayIndex) => {
    const dayNumber = dayIndex + 1;
    const dayLabel = `Day ${dayNumber}`;
    const dayTitle = day.title ?? dayLabel;
    const dayStyle = wholeTripDayStyle(dayIndex);
    const orderedPlan = orderedDayPlan(day);
    let sightseeingPosition = 0;

    for (const [planIndex, planItem] of orderedPlan.entries()) {
      const stop = stopsById.get(planItem.stopId);
      if (!stop) continue;
      const sightseeing = isSightseeingStop(stop);
      const localPosition = sightseeing ? ++sightseeingPosition : undefined;
      markers.push({
        kind: 'stop',
        stopId: stop.id,
        dayId: day.id,
        dayNumber,
        dayLabel,
        dayTitle,
        dayStyle,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        itineraryPosition: planIndex + 1,
        ...(localPosition === undefined
          ? {}
          : { sightseeingPosition: localPosition }),
        markerLabel: sightseeing
          ? `D${dayNumber}-${localPosition}`
          : logisticsMarkerLabel(dayNumber, stop.logisticsRole),
        markerRole: sightseeing
          ? 'sightseeing'
          : markerRole(stop.logisticsRole),
        ...(stop.logisticsRole === undefined
          ? {}
          : { logisticsRole: stop.logisticsRole }),
        semanticLabel: stopSemanticLabel(stop),
        priority: stop.priority,
        status: stopStatus(execution, stop.id),
      });
    }

    const planPairs = orderedPlan.slice(0, -1).map((item, index) => ({
      fromStopId: item.stopId,
      toStopId: orderedPlan[index + 1].stopId,
    }));
    const legs = planPairs.flatMap<WholeTripRouteLegView>((pair) => {
      const from = stopsById.get(pair.fromStopId);
      const to = stopsById.get(pair.toStopId);
      if (!from || !to) return [];
      return (trip.legs ?? [])
        .filter(
          (leg) =>
            leg.fromStopId === pair.fromStopId &&
            leg.toStopId === pair.toStopId,
        )
        .map((leg) => {
          const navigationViaPoints = (leg.navigationWaypoints ?? []).map(
            (point) => [point.longitude, point.latitude] as const,
          );
          const coordinates = leg.geometry?.length
            ? leg.geometry.map(
                (point) => [point.longitude, point.latitude] as const,
              )
            : [
                [from.longitude, from.latitude] as const,
                ...navigationViaPoints,
                [to.longitude, to.latitude] as const,
              ];
          return {
            legId: leg.id,
            fromStopId: leg.fromStopId,
            toStopId: leg.toStopId,
            mode: leg.mode,
            coordinates,
            navigationViaPoints,
            representation: leg.geometry?.length
              ? ('prepared-geometry' as const)
              : navigationViaPoints.length
                ? ('prepared-waypoints' as const)
                : ('schematic-endpoints' as const),
          };
        });
    });
    routeGroups.push({
      dayId: day.id,
      dayNumber,
      dayLabel,
      dayTitle,
      dayStyle,
      legs,
    });

    const postDay = day.postDayDestination;
    if (postDay && 'latitude' in postDay.navigationTarget) {
      markers.push({
        kind: 'post-day',
        destinationId: postDay.id,
        dayId: day.id,
        dayNumber,
        dayLabel,
        dayTitle,
        dayStyle,
        name: postDay.name,
        latitude: postDay.navigationTarget.latitude,
        longitude: postDay.navigationTarget.longitude,
        markerLabel: `D${dayNumber} AFTER`,
        markerRole: 'post-day',
        semanticLabel: 'After sightseeing',
        ...(postDay.targetArrivalTime === undefined
          ? {}
          : { targetArrivalTime: postDay.targetArrivalTime }),
      });
    }

    days.push({
      dayId: day.id,
      dayNumber,
      label: dayLabel,
      title: dayTitle,
      style: dayStyle,
      ...(postDay === undefined
        ? {}
        : { postDayDestinationName: postDay.name }),
    });
  });

  const stopCoordinates = markers
    .filter(
      (marker): marker is WholeTripStopMarkerView => marker.kind === 'stop',
    )
    .map(({ longitude, latitude }) => ({ longitude, latitude }));
  const sightseeingCoordinates = markers
    .filter(
      (marker): marker is WholeTripStopMarkerView =>
        marker.kind === 'stop' && marker.markerRole === 'sightseeing',
    )
    .map(({ longitude, latitude }) => ({ longitude, latitude }));
  const routeCoordinates = routeGroups.flatMap((group) =>
    group.legs.flatMap((leg) =>
      leg.coordinates.map(([longitude, latitude]) => ({
        longitude,
        latitude,
      })),
    ),
  );
  const allBoundsCoordinates = [
    ...markers.map(({ longitude, latitude }) => ({
      longitude,
      latitude,
    })),
    ...routeCoordinates,
  ];

  return {
    days,
    markers,
    routeGroups,
    initialBoundsCoordinates: sightseeingFocusedBounds(sightseeingCoordinates, [
      ...stopCoordinates,
      ...routeCoordinates,
    ]),
    allBoundsCoordinates,
  };
}
