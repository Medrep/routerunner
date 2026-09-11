'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Expand,
  Flag,
  Footprints,
  ListOrdered,
  MapPin,
  Navigation,
  Plane,
  Route,
  Ship,
  TrainFront,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import RouteMap from '@/components/routerunner/route-map';
import {
  defaultViewedDayId,
  deriveTripOverviewPresentation,
} from '@/components/routerunner/trip-overview-presentation';
import {
  dayPlanPresentationModel,
  plannedStopPresentation,
} from '@/components/routerunner/day-plan-presentation';
import { stopDetailsCtaModel } from '@/components/routerunner/stop-visit-content';
import { StopVisitContent } from '@/components/routerunner/stop-visit-content-view';
import { manualSkipCurrentStop } from '@/components/routerunner/manual-skip';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { copenhagenStopIds } from '@/data/trips/copenhagen';
import {
  selectableTrips,
  selectTripFromSearch,
  tripSelectionHref,
} from '@/data/trips';
import { useForegroundLocation } from '@/hooks/use-foreground-location';
import {
  acceptSkipRecommendation,
  acknowledgeRuleRecommendation,
  activeExecutionRecommendation,
  cancelDoNowStop,
  completeCurrentStop,
  currentGoogleMapsNavigationUrl,
  deriveDayPreviewRouteMapView,
  deriveRouteMapView,
  deriveStopActionModel,
  doNowStop,
  endDay,
  isWaitingDoNow,
  isSightseeingStop,
  markAlreadyVisited,
  nextEligiblePendingStopId,
  orderedDayPlan,
  persistExecutionTransition,
  pendingForLaterActionModels,
  postDayGoogleMapsNavigationUrl,
  projectSchedule,
  recordDecisionShown,
  restoreOrCreateExecutionState,
  saveAllForLaterAndEndDay,
  saveCurrentForLater as saveCurrentForLaterTransition,
  saveExecutionState,
  startDayAndBuildNavigation,
  switchExecutionDay,
  shouldRefreshScheduleProjection,
  stopActivityLabel,
  stopSemanticLabel,
  tripExecutionLifecycle,
  waitingDoNowActionModels,
  type RouteMapStopStatus,
  type KnownOrUnknownDuration,
  type Stop,
  type StopId,
  type ScheduleProjection,
  type TransitionResult,
  type TravelMode,
  type TripExecutionState,
} from '@/domain';

type PresentationStatus = RouteMapStopStatus;

function Mode({ mode, size = 16 }: { mode: TravelMode; size?: number }) {
  return mode === 'ferry' ? (
    <Ship size={size} />
  ) : mode === 'transit' ? (
    <TrainFront size={size} />
  ) : (
    <Footprints size={size} />
  );
}

function formatProjectedTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

function formatRemainingDuration(minutes: number) {
  const rounded = Math.ceil(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder} min remaining`;
  if (remainder === 0) return `${hours} h remaining`;
  return `${hours} h ${remainder} min remaining`;
}

function formatBufferAmount(minutes: number) {
  return minutes >= 0
    ? `${Math.floor(minutes)} min buffer`
    : `${Math.ceil(Math.abs(minutes))} min over`;
}

function scheduleClassName(projection: ScheduleProjection) {
  if (projection.status === 'unavailable') return 'schedule unavailable';
  if (projection.status !== 'calculable') return 'schedule';
  if (projection.health === 'SCHEDULE_TIGHT') return 'schedule tight';
  if (projection.health === 'DEADLINE_AT_RISK') return 'schedule risk';
  return 'schedule';
}

function ScheduleSummary({
  projection,
  hardEndTime,
  timeZone,
}: {
  projection: ScheduleProjection;
  hardEndTime?: string;
  timeZone: string;
}) {
  if (projection.status === 'inactive') {
    const completeLabel =
      projection.reason === 'trip_complete'
        ? 'Trip complete'
        : projection.reason === 'day_complete'
          ? 'Day complete'
          : undefined;
    return (
      <div className="schedule">
        <strong>
          <i />
          {completeLabel ??
            (projection.reason === 'not_started'
              ? 'Ready to start'
              : 'No remaining work')}
        </strong>
        <span>
          {completeLabel
            ? 'Active schedule closed'
            : projection.reason === 'not_started'
              ? 'Projection begins when the first stop becomes Current'
              : hardEndTime
                ? `Sightseeing ends ${hardEndTime}`
                : 'Active route is clear'}
        </span>
      </div>
    );
  }

  if (projection.status === 'unavailable') {
    return (
      <div className="schedule unavailable">
        <strong>
          <i />
          Schedule estimate unavailable
        </strong>
        {hardEndTime && <span>Sightseeing ends {hardEndTime}</span>}
      </div>
    );
  }

  const finish = formatProjectedTime(projection.estimatedFinishAt, timeZone);
  if (!projection.health || projection.bufferMinutes === undefined) {
    return (
      <div className="schedule">
        <strong>
          <i />
          Estimated finish {finish}
        </strong>
        <span>{formatRemainingDuration(projection.remainingMinutes)}</span>
      </div>
    );
  }

  const healthLabel =
    projection.health === 'ON_PLAN'
      ? 'On plan'
      : projection.health === 'SCHEDULE_TIGHT'
        ? 'Schedule tight'
        : 'Deadline at risk';
  const bufferLabel =
    projection.bufferMinutes >= 0
      ? `${Math.floor(projection.bufferMinutes)} min buffer`
      : `${Math.ceil(Math.abs(projection.bufferMinutes))} min over`;

  return (
    <div className={scheduleClassName(projection)}>
      <strong>
        <i />
        {healthLabel}
      </strong>
      <span>Estimated finish {finish}</span>
      <span>
        {bufferLabel} · Sightseeing ends {hardEndTime}
      </span>
    </div>
  );
}

const subscribeToHydration = () => () => {};
const clientHydratedSnapshot = () => true;
const serverHydratedSnapshot = () => false;

export default function Page() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydratedSnapshot,
    serverHydratedSnapshot,
  );

  if (!hydrated) {
    return (
      <main className="prototype" aria-busy="true">
        <div className="prototype-bar">
          <span>
            PRODUCTION EXECUTION <b>RESTORING</b>
          </span>
          <span>Loading local progress</span>
        </div>
      </main>
    );
  }

  return <ExecutionPage />;
}

function ExecutionPage() {
  const [trip] = useState(() => selectTripFromSearch(window.location.search));
  const [execution, setExecution] = useState<TripExecutionState>(
    () => restoreOrCreateExecutionState(trip, new Date().toISOString()).state,
  );
  const [viewedDayId, setViewedDayId] = useState(
    () => defaultViewedDayId(trip, execution) ?? '',
  );
  const [tripSurface, setTripSurface] = useState<'day' | 'overview'>('day');
  const [projectionNow, setProjectionNow] = useState(() =>
    new Date().toISOString(),
  );
  const [full, setFull] = useState(false);
  const [detail, setDetail] = useState<StopId | null>(null);
  const [feedback, setFeedback] = useState('');
  const [endDayResolutionOpen, setEndDayResolutionOpen] = useState(false);
  const [switchResolutionTargetDayId, setSwitchResolutionTargetDayId] =
    useState<string>();
  const initialExecution = useRef(execution);
  const selectedTripOption = selectableTrips.find(
    ({ trip: optionTrip }) => optionTrip.id === trip.id,
  )!;
  const lifecycle = tripExecutionLifecycle(trip, execution);
  const overview = useMemo(
    () => deriveTripOverviewPresentation(trip, execution, viewedDayId),
    [execution, trip, viewedDayId],
  );
  const viewedDay =
    overview.days.find(({ dayId }) => dayId === overview.viewedDayId) ??
    overview.days[0];
  const day = viewedDay.day;
  const orderedPlan = orderedDayPlan(day);
  const dayPlanModel = dayPlanPresentationModel(day, trip.stops);
  const sightseeingStopCount = dayPlanModel.filter(({ stop }) =>
    isSightseeingStop(stop),
  ).length;
  const logisticsStopCount = dayPlanModel.length - sightseeingStopCount;
  const isReadOnlyPreview = overview.isReadOnlyPreview;
  const refreshProjectionClock = shouldRefreshScheduleProjection(execution);
  const executionDayIndex = trip.days.findIndex(
    (candidate) => candidate.id === execution.executionDayId,
  );
  const nextPlannedDay =
    lifecycle.status === 'TRIP_COMPLETE' || executionDayIndex < 0
      ? undefined
      : trip.days[executionDayIndex + 1];
  const nextPlannedOverviewDay = nextPlannedDay
    ? overview.days[executionDayIndex + 1]
    : undefined;
  const viewedDayCanStart = viewedDay.dayId === nextPlannedDay?.id;

  useEffect(() => {
    saveExecutionState(
      trip,
      initialExecution.current,
      initialExecution.current.lastUpdatedAt,
    );
  }, [trip]);

  useEffect(() => {
    if (!refreshProjectionClock) return;
    const timer = window.setInterval(
      () => setProjectionNow(new Date().toISOString()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, [refreshProjectionClock]);

  const started = lifecycle.status === 'ACTIVE';
  const lifecycleComplete =
    lifecycle.status === 'DAY_COMPLETE' || lifecycle.status === 'TRIP_COMPLETE';
  const lifecycleDay =
    lifecycle.status === 'READY'
      ? undefined
      : trip.days.find((candidate) => candidate.id === lifecycle.dayId);
  const postDayDestination = lifecycleComplete
    ? lifecycleDay?.postDayDestination
    : undefined;
  const postDayNavigationUrl = postDayDestination
    ? postDayGoogleMapsNavigationUrl(postDayDestination)
    : undefined;
  const location = useForegroundLocation(started);
  const current =
    trip.stops.find((stop) => stop.id === execution.currentStopId) ?? null;
  const currentActionModel = current
    ? deriveStopActionModel(trip, execution, current.id)
    : undefined;
  const firstPreparedStopId = orderedPlan[0]?.stopId;
  const firstPreparedStop = trip.stops.find(
    (stop) => stop.id === firstPreparedStopId,
  );
  const displayedStop = !isReadOnlyPreview
    ? (current ??
      (lifecycle.status === 'READY' ? firstPreparedStop : undefined))
    : undefined;
  const displayedPlanItem = plannedStopPresentation(
    dayPlanModel,
    displayedStop?.id,
  );
  const detailsCta = displayedStop ? stopDetailsCtaModel(displayedStop) : null;
  const nextStopId = started
    ? nextEligiblePendingStopId(trip, execution)
    : lifecycle.status === 'READY'
      ? orderedPlan[1]?.stopId
      : undefined;
  const nextStop = trip.stops.find((stop) => stop.id === nextStopId) ?? null;
  const nextPlanItem = plannedStopPresentation(dayPlanModel, nextStopId);
  const detailStop = trip.stops.find((stop) => stop.id === detail) ?? null;
  const detailActionModel = detail
    ? deriveStopActionModel(trip, execution, detail)
    : undefined;
  const detailPlannedDay = detail
    ? overview.days.find((candidate) =>
        candidate.stops.some((stop) => stop.stopId === detail),
      )
    : undefined;
  const detailHistory = detailPlannedDay?.stops.find(
    (stop) => stop.stopId === detail,
  );
  const detailPlanItem = detailPlannedDay
    ? plannedStopPresentation(
        dayPlanPresentationModel(detailPlannedDay.day, trip.stops),
        detail,
      )
    : null;
  const waitingDoNowModels = useMemo(
    () => waitingDoNowActionModels(trip, execution),
    [execution, trip],
  );
  const forLaterModels = useMemo(
    () => pendingForLaterActionModels(trip, execution),
    [execution, trip],
  );
  const completed = viewedDay.completedStopCount;
  const noAvailableCurrent = started && current === null;
  const scheduleProjection = useMemo(
    () => projectSchedule(trip, execution, projectionNow),
    [execution, projectionNow, trip],
  );
  const recommendation = useMemo(
    () => activeExecutionRecommendation(trip, execution, scheduleProjection),
    [execution, scheduleProjection, trip],
  );
  const recommendationStop = recommendation
    ? (trip.stops.find((stop) => stop.id === recommendation.targetStopId) ??
      null)
    : null;
  const constraintAlerts =
    isReadOnlyPreview || scheduleProjection.status === 'inactive'
      ? []
      : scheduleProjection.constraintAlerts;

  useEffect(() => {
    if (!recommendation || isReadOnlyPreview) return;
    if (
      execution.eventLog.some(
        (event) =>
          event.type === 'decision_shown' &&
          event.ruleId === recommendation.ruleId &&
          event.executionDayId === recommendation.executionDayId &&
          event.severity === recommendation.severity,
      )
    ) {
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const now = new Date().toISOString();
      const persisted = persistExecutionTransition(
        trip,
        execution,
        recordDecisionShown(trip, execution, recommendation.ruleId, now),
      );
      if (persisted.status === 'accepted') {
        setExecution(persisted.state);
        setProjectionNow(now);
      }
    });
    return () => {
      active = false;
    };
  }, [execution, isReadOnlyPreview, recommendation, trip]);

  function modelStopHistory(stopId: StopId) {
    return viewedDay.stops.find((stop) => stop.stopId === stopId);
  }

  function presentationStatus(stopId: StopId): PresentationStatus {
    const stopExecution = execution.stopExecutions[stopId];
    if (!isReadOnlyPreview && execution.currentStopId === stopId)
      return 'current';
    if (isWaitingDoNow(execution, stopId)) return 'queued';
    if (!isReadOnlyPreview && nextStopId === stopId && started) return 'next';
    if (stopExecution.status === 'completed') return 'completed';
    if (stopExecution.status === 'skipped') return 'skipped';
    if (
      stopExecution.status === 'pending' &&
      stopExecution.scheduledDayId === null
    )
      return 'saved';
    return 'future';
  }

  const mapView = useMemo(() => {
    const coordinates =
      location.status === 'available' ? location.coordinates : undefined;
    return isReadOnlyPreview
      ? deriveDayPreviewRouteMapView(trip, execution, day.id, coordinates)
      : deriveRouteMapView(trip, execution, coordinates);
  }, [day.id, execution, isReadOnlyPreview, location, trip]);
  const navigationUrl = currentGoogleMapsNavigationUrl(trip, execution);

  function apply(
    result: TransitionResult,
    message: (state: TripExecutionState) => string,
  ) {
    const persisted = persistExecutionTransition(trip, execution, result);
    if (persisted.status === 'rejected') {
      setFeedback(persisted.error.message);
      return;
    }
    setEndDayResolutionOpen(false);
    setSwitchResolutionTargetDayId(undefined);
    setExecution(persisted.state);
    setProjectionNow(persisted.state.lastUpdatedAt);
    setFeedback(message(persisted.state));
  }

  function beginDayTransition() {
    const result = startDayAndBuildNavigation(
      trip,
      execution,
      day.id,
      new Date().toISOString(),
    );
    if (result.status === 'rejected') {
      setFeedback(result.result.error.message);
      return result;
    }
    setExecution(result.result.state);
    setProjectionNow(result.result.state.lastUpdatedAt);
    setFeedback(
      result.result.persistence.status === 'saved'
        ? `${firstPreparedStop?.name ?? 'The first stop'} is now Current.`
        : `${firstPreparedStop?.name ?? 'The first stop'} is now Current. Local save is unavailable.`,
    );
    return result;
  }

  function beginDay() {
    beginDayTransition();
  }

  function beginDayAndNavigate() {
    const result = beginDayTransition();
    if (result.status === 'accepted' && result.navigationUrl) {
      window.location.assign(result.navigationUrl);
    }
  }

  function unresolvedNewDayInbound(): KnownOrUnknownDuration {
    // Coordinates alone are not a travel-duration estimate. Until a routing
    // provider resolves them, persist the explicit unavailable result.
    return { status: 'unknown', reason: 'unavailable' };
  }

  function requestExecutionDaySwitch(
    targetDayId: string,
    resolution?: 'save_all_for_later',
  ) {
    const result = switchExecutionDay(
      trip,
      execution,
      targetDayId,
      new Date().toISOString(),
      unresolvedNewDayInbound(),
      resolution,
    );
    if (result.status === 'rejected') {
      setFeedback(result.error.message);
      return;
    }
    if (result.status === 'leftover_resolution_required') {
      const oldDayNumber =
        trip.days.findIndex((day) => day.id === result.oldDayId) + 1;
      setSwitchResolutionTargetDayId(result.targetDayId);
      setFeedback(
        `Day ${oldDayNumber} still has ${result.remainingStopIds.length} stops remaining.`,
      );
      return;
    }

    const persisted = persistExecutionTransition(trip, execution, {
      ok: true,
      state: result.state,
    });
    if (persisted.status === 'rejected') {
      setFeedback(persisted.error.message);
      return;
    }
    setEndDayResolutionOpen(false);
    setSwitchResolutionTargetDayId(undefined);
    setExecution(persisted.state);
    setViewedDayId(targetDayId);
    setTripSurface('day');
    setProjectionNow(persisted.state.lastUpdatedAt);
    const promoted = trip.stops.find(
      (stop) => stop.id === persisted.state.currentStopId,
    );
    setFeedback(
      promoted
        ? `${promoted.name} is now Current.`
        : 'New execution day started with no Current.',
    );
  }

  function done() {
    if (!current) return;
    const completedName = current.name;
    apply(
      completeCurrentStop(trip, execution, new Date().toISOString()),
      (state) => {
        const promoted = trip.stops.find(
          (stop) => stop.id === state.currentStopId,
        );
        return promoted
          ? `${completedName} completed. ${promoted.name} is now Current.`
          : `${completedName} completed. No Current remains.`;
      },
    );
    setDetail(null);
  }

  function skip() {
    if (!current) return;
    const skippedName = current.name;
    const manualSkip = manualSkipCurrentStop(
      trip,
      execution,
      new Date().toISOString(),
      (message) => window.confirm(message),
    );
    if (manualSkip.status === 'cancelled') return;
    apply(manualSkip.result, (state) => {
      const promoted = trip.stops.find(
        (stop) => stop.id === state.currentStopId,
      );
      return promoted
        ? `${skippedName} skipped. ${promoted.name} is now Current.`
        : `${skippedName} skipped. No Current remains.`;
    });
    setDetail(null);
  }

  function saveCurrentForLater() {
    if (!current) return;
    const savedName = current.name;
    apply(
      saveCurrentForLaterTransition(trip, execution, new Date().toISOString()),
      (state) => {
        const promoted = trip.stops.find(
          (stop) => stop.id === state.currentStopId,
        );
        return promoted
          ? `${savedName} saved for later. ${promoted.name} is now Current.`
          : `${savedName} saved for later. No Current remains.`;
      },
    );
    setDetail(null);
  }

  function requestEndDay() {
    const result = endDay(trip, execution, new Date().toISOString());
    if (!result.ok && result.error.code === 'END_DAY_REQUIRES_RESOLUTION') {
      setEndDayResolutionOpen(true);
      setFeedback(result.error.message);
      return;
    }
    apply(result, (state) =>
      tripExecutionLifecycle(trip, state).status === 'TRIP_COMPLETE'
        ? 'Trip complete.'
        : 'Day complete.',
    );
  }

  function saveAllForLaterAndCloseDay() {
    setEndDayResolutionOpen(false);
    apply(
      saveAllForLaterAndEndDay(trip, execution, new Date().toISOString()),
      (state) =>
        tripExecutionLifecycle(trip, state).status === 'TRIP_COMPLETE'
          ? 'Remaining stops saved for later. Trip complete.'
          : 'Remaining stops saved for later. Day complete.',
    );
  }

  function doNowSelectedStop() {
    if (!detail) return;
    const stopName = detailStop?.name ?? 'Stop';
    apply(
      doNowStop(trip, execution, detail, new Date().toISOString()),
      (state) =>
        state.currentStopId === detail
          ? `${stopName} is now Current.`
          : `${stopName} queued for now.`,
    );
    setDetail(null);
  }

  function cancelSelectedDoNow() {
    if (!detail) return;
    const stopName = detailStop?.name ?? 'Stop';
    apply(
      cancelDoNowStop(trip, execution, detail, new Date().toISOString()),
      () => `${stopName} removed from the Do Now queue.`,
    );
  }

  function markSelectedAlreadyVisited() {
    if (!detail) return;
    const stopName = detailStop?.name ?? 'Stop';
    apply(
      markAlreadyVisited(trip, execution, detail, new Date().toISOString()),
      () => `${stopName} recorded as already visited.`,
    );
    setDetail(null);
  }

  function keepRecommendation() {
    if (!recommendation) return;
    const now = new Date().toISOString();
    const result = acknowledgeRuleRecommendation(
      trip,
      execution,
      recommendation.ruleId,
      now,
    );
    if (!result.ok) setProjectionNow(now);
    apply(
      result,
      () =>
        `${recommendationStop?.shortName ?? recommendationStop?.name ?? 'Stop'} kept.`,
    );
  }

  function acceptRecommendation() {
    if (!recommendation || !recommendationStop) return;
    if (
      recommendationStop.priority === 'must' &&
      !window.confirm(`Skip must-see stop ${recommendationStop.name}?`)
    ) {
      return;
    }

    const now = new Date().toISOString();
    const before = projectSchedule(trip, execution, now);
    const result = acceptSkipRecommendation(
      trip,
      execution,
      recommendation.ruleId,
      now,
    );
    const persisted = persistExecutionTransition(trip, execution, result);
    if (persisted.status === 'rejected') {
      setProjectionNow(now);
      setFeedback(persisted.error.message);
      return;
    }

    const after = projectSchedule(trip, persisted.state, now);
    const recoveredMinutes =
      before.status === 'calculable' &&
      after.status === 'calculable' &&
      before.bufferMinutes !== undefined &&
      after.bufferMinutes !== undefined
        ? after.bufferMinutes - before.bufferMinutes
        : undefined;
    setExecution(persisted.state);
    setProjectionNow(now);
    setFeedback(
      recoveredMinutes !== undefined && recoveredMinutes > 0
        ? `${recommendationStop.shortName ?? recommendationStop.name} skipped · +${Math.floor(recoveredMinutes)} min buffer`
        : `${recommendationStop.shortName ?? recommendationStop.name} skipped`,
    );
  }

  function preparedLeg(
    from: Stop | undefined | null,
    to: Stop | undefined | null,
  ) {
    if (!from || !to) return undefined;
    return trip.legs?.find(
      (candidate) =>
        candidate.fromStopId === from.id && candidate.toStopId === to.id,
    );
  }

  const nextLeg = preparedLeg(displayedStop, nextStop);

  function openTripOverview() {
    setDetail(null);
    setFull(false);
    setTripSurface('overview');
  }

  function viewPlannedDay(dayId: string) {
    setViewedDayId(dayId);
    setDetail(null);
    setFull(false);
    setEndDayResolutionOpen(false);
    setSwitchResolutionTargetDayId(undefined);
    setFeedback('');
    setTripSurface('day');
  }

  function returnToExecutionView() {
    const executionViewDayId = defaultViewedDayId(trip, execution);
    if (executionViewDayId) setViewedDayId(executionViewDayId);
    setDetail(null);
    setFull(false);
    setFeedback('');
    setTripSurface('day');
  }

  return (
    <>
      <main className="prototype">
        <div className="prototype-bar">
          <span>
            PRODUCTION EXECUTION <b>LOCAL</b>
          </span>
          <Select
            value={trip.id}
            onValueChange={(tripId) => {
              if (tripId && tripId !== trip.id) {
                window.location.assign(tripSelectionHref(tripId));
              }
            }}
          >
            <SelectTrigger
              className="scenario-select"
              aria-label="Select private-test trip"
            >
              <SelectValue>{selectedTripOption.label}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {selectableTrips.map(({ label, trip: optionTrip }) => (
                <SelectItem
                  key={optionTrip.id}
                  value={optionTrip.id}
                  className="scenario-option"
                >
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <header className="brand">
          <div className="brand-mark">
            <Route size={23} strokeWidth={2.4} />
          </div>
          <strong>RouteRunner</strong>
          <span>YOUR DAY. ONE CLEAR NEXT STEP.</span>
          {trip.days.length > 1 && (
            <button
              type="button"
              className="overview-trigger"
              onClick={openTripOverview}
              aria-current={tripSurface === 'overview' ? 'page' : undefined}
            >
              <CalendarDays size={16} /> Trip overview
            </button>
          )}
          <div className="day-chip">
            <MapPin size={14} />
            {trip.city}
          </div>
        </header>
        <section className="trip-heading">
          <div>
            <p className="eyebrow">
              {tripSurface === 'overview'
                ? `TRIP OVERVIEW · ${trip.days.length} DAYS`
                : trip.days.length === 1
                  ? `ONE DAY · ${dayPlanModel.length} STOPS`
                  : `${viewedDay.label.toUpperCase()} OF ${trip.days.length} · ${isReadOnlyPreview ? 'PREVIEW · ' : ''}${sightseeingStopCount} ${logisticsStopCount > 0 ? `SIGHTS · ${logisticsStopCount} LOGISTICS` : 'STOPS'}`}
            </p>
            <h1>
              {trip.title}
              <span className="heading-dot">.</span>
            </h1>
          </div>
          {tripSurface === 'overview' ? (
            <div className="view-status">
              <strong>{trip.days.length} prepared days</strong>
              <span>Choose a day to inspect</span>
            </div>
          ) : isReadOnlyPreview ? (
            <div className="view-status preview">
              <strong>Preview · not executing</strong>
              <span>
                {overview.executionContext
                  ? `${overview.executionContext.dayLabel} remains execution context`
                  : 'No execution day is active'}
              </span>
            </div>
          ) : (
            <ScheduleSummary
              projection={scheduleProjection}
              hardEndTime={day.hardEndTime}
              timeZone={trip.timeZone}
            />
          )}
        </section>
        {tripSurface === 'overview' ? (
          <section className="trip-overview" aria-label="Trip overview">
            <div className="trip-overview-heading">
              <div>
                <p className="eyebrow">PLANNED DAYS</p>
                <h2>{trip.city ?? trip.title}</h2>
              </div>
              <span>
                {trip.startDate} — {trip.endDate}
              </span>
            </div>
            <div className="trip-overview-days">
              {overview.days.map((overviewDay) => {
                const statusLabel =
                  overviewDay.lifecycleStatus === 'active'
                    ? 'Active'
                    : overviewDay.lifecycleStatus === 'completed'
                      ? 'Completed'
                      : 'Upcoming';
                return (
                  <article
                    key={overviewDay.dayId}
                    className={`trip-overview-day ${overviewDay.lifecycleStatus} ${overviewDay.isViewed ? 'viewed' : ''}`}
                  >
                    <div className="trip-overview-day-copy">
                      <div className="trip-overview-day-title">
                        <span className="trip-overview-number">
                          {overviewDay.dayNumber}
                        </span>
                        <div>
                          <p className="eyebrow">
                            {overviewDay.label.toUpperCase()} ·{' '}
                            {statusLabel.toUpperCase()}
                            {overviewDay.isViewed ? ' · VIEWED' : ''}
                          </p>
                          <h3>{overviewDay.day.title ?? overviewDay.label}</h3>
                          {overviewDay.day.date && (
                            <time dateTime={overviewDay.day.date}>
                              {overviewDay.day.date}
                            </time>
                          )}
                        </div>
                      </div>
                      <p className="trip-overview-summary">
                        {overviewDay.logisticsStopCount > 0
                          ? `${overviewDay.sightseeingStopCount} sights · ${overviewDay.logisticsStopCount} logistics`
                          : `${overviewDay.plannedStopCount} planned stops`}
                        {overviewDay.completedStopCount > 0 &&
                          ` · ${overviewDay.completedStopCount} visited`}
                        {overviewDay.skippedStopCount > 0 &&
                          ` · ${overviewDay.skippedStopCount} skipped`}
                        {overviewDay.savedStopCount > 0 &&
                          ` · ${overviewDay.savedStopCount} for later`}
                      </p>
                      <p className="trip-overview-stop-names">
                        {overviewDay.stopNames.join(' · ') ||
                          'No planned stops'}
                      </p>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className={
                          overviewDay.dayId === overview.executionViewDayId
                            ? 'primary'
                            : 'secondary'
                        }
                        onClick={() => viewPlannedDay(overviewDay.dayId)}
                      >
                        Preview day
                        <ChevronRight size={18} />
                      </button>
                      {overviewDay.dayId === nextPlannedDay?.id && (
                        <button
                          type="button"
                          className="primary"
                          onClick={() =>
                            requestExecutionDaySwitch(overviewDay.dayId)
                          }
                        >
                          Start {overviewDay.label}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="trip-overview-note">
              Choosing a day changes only what you are viewing. Execution stays
              with the active day.
            </p>
          </section>
        ) : (
          <div className="workspace">
            <div className="map-column">
              <section className="map-panel">
                <RouteMap
                  view={mapView}
                  location={location}
                  onStop={setDetail}
                />
                <button className="map-expand" onClick={() => setFull(true)}>
                  <Expand size={17} />
                  Full map
                </button>
              </section>
              <div className="map-day-note">
                <Flag size={18} />
                <p>
                  {isReadOnlyPreview
                    ? `${viewedDay.label} planned route.`
                    : 'A day on your terms.'}
                  <span>
                    {isReadOnlyPreview
                      ? `${overview.executionContext?.dayLabel ?? 'Execution'} remains unchanged.`
                      : 'Follow the route. Leave room for the city.'}
                  </span>
                </p>
              </div>
            </div>
            <div className="day-column">
              <section className="execution" aria-label="Current step">
                <div className="execution-top">
                  <span className="active-label">
                    {isReadOnlyPreview
                      ? `${viewedDay.label.toUpperCase()} PREVIEW`
                      : current
                        ? deriveStopActionModel(trip, execution, current.id)
                            ?.role === 'current_do_now'
                          ? 'NOW · DOING TODAY'
                          : 'NOW'
                        : lifecycle.status === 'TRIP_COMPLETE'
                          ? 'TRIP COMPLETE'
                          : lifecycle.status === 'DAY_COMPLETE'
                            ? 'DAY COMPLETE'
                            : started
                              ? 'NO CURRENT'
                              : 'FIRST STOP'}
                  </span>
                  <span className="current-time">
                    <Clock size={14} />
                    {isReadOnlyPreview
                      ? 'Not executing'
                      : started
                        ? 'Day active'
                        : lifecycleComplete
                          ? 'Execution ended'
                          : 'Not started'}
                  </span>
                </div>
                {isReadOnlyPreview ? (
                  <div className="preview-context">
                    <div>
                      <strong>Viewing {viewedDay.label}</strong>
                      <p>
                        This planned day is read-only. Stops and details below
                        preserve the original itinerary.
                      </p>
                    </div>
                    <div className="preview-execution-context">
                      <span>EXECUTION</span>
                      <strong>
                        {overview.executionContext?.dayLabel ?? 'Not started'}
                      </strong>
                      <p>
                        {overview.executionContext?.currentStopName
                          ? `Current: ${overview.executionContext.currentStopName}`
                          : 'No Current'}
                      </p>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={returnToExecutionView}
                      >
                        <ArrowLeft size={19} /> Return to execution
                      </button>
                      {viewedDayCanStart && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => requestExecutionDaySwitch(day.id)}
                        >
                          Start {viewedDay.label}
                        </button>
                      )}
                    </div>
                  </div>
                ) : lifecycleComplete ? (
                  <div className="finished">
                    <div className="finish-check">
                      <Check size={28} />
                    </div>
                    <h2>
                      {lifecycle.status === 'TRIP_COMPLETE'
                        ? 'Trip complete'
                        : 'Day complete'}
                    </h2>
                    <p>
                      {lifecycle.status === 'TRIP_COMPLETE'
                        ? 'Sightseeing execution is complete. A good day, well spent.'
                        : 'This day is complete. The trip still has prepared days ahead.'}
                    </p>
                    {lifecycle.status === 'DAY_COMPLETE' &&
                      nextPlannedOverviewDay && (
                        <div className="preview-context">
                          <div>
                            <strong>Tomorrow</strong>
                            <p>
                              {nextPlannedOverviewDay.label} ·{' '}
                              {nextPlannedOverviewDay.day.title ??
                                `${nextPlannedOverviewDay.plannedStopCount} planned stops`}
                            </p>
                          </div>
                          <div className="actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                viewPlannedDay(nextPlannedOverviewDay.dayId)
                              }
                            >
                              Preview day
                            </button>
                            <button
                              type="button"
                              className="primary"
                              onClick={() =>
                                requestExecutionDaySwitch(
                                  nextPlannedOverviewDay.dayId,
                                )
                              }
                            >
                              Start {nextPlannedOverviewDay.label}
                            </button>
                          </div>
                        </div>
                      )}
                    {postDayDestination && (
                      <div className="airport-callout">
                        <Plane size={22} aria-hidden="true" />
                        <div>
                          <strong>After sightseeing</strong>
                          <span>{postDayDestination.name}</span>
                          {postDayDestination.targetArrivalTime && (
                            <small>
                              Target arrival{' '}
                              <time
                                dateTime={postDayDestination.targetArrivalTime}
                              >
                                {postDayDestination.targetArrivalTime}
                              </time>
                            </small>
                          )}
                        </div>
                      </div>
                    )}
                    {postDayNavigationUrl && (
                      <div className="actions">
                        <a className="primary" href={postDayNavigationUrl}>
                          <Navigation size={20} /> Directions to{' '}
                          {postDayDestination?.name}
                        </a>
                      </div>
                    )}
                  </div>
                ) : noAvailableCurrent ? (
                  <div className="finished">
                    <div className="finish-check">
                      <Check size={28} />
                    </div>
                    <h2>No Current remains</h2>
                    <p>
                      Available work is exhausted. End the day explicitly when
                      you are ready.
                    </p>
                    <div className="actions">
                      <button className="primary" onClick={requestEndDay}>
                        <Flag size={20} /> End Day
                      </button>
                    </div>
                  </div>
                ) : displayedStop ? (
                  <>
                    <button
                      className="now stop-open"
                      onClick={() => setDetail(displayedStop.id)}
                    >
                      <span className="big-number">
                        {displayedPlanItem?.markerLabel ?? '—'}
                      </span>
                      <div>
                        <h2>{displayedStop.name}</h2>
                        <p>
                          {started
                            ? stopActivityLabel(displayedStop)
                            : 'Your day begins here'}{' '}
                          · ~{displayedStop.plannedVisitMinutes} min
                        </p>
                        {displayedPlanItem?.plannedStartTime && (
                          <p className="planned-start-time">
                            Planned{' '}
                            <time dateTime={displayedPlanItem.plannedStartTime}>
                              {displayedPlanItem.plannedStartTime}
                            </time>
                          </p>
                        )}
                      </div>
                      <ChevronRight size={22} />
                    </button>
                    <StopVisitContent stop={displayedStop} surface="current" />
                    {detailsCta && (
                      <button
                        type="button"
                        className="details-cta"
                        onClick={() => setDetail(detailsCta.detailStopId)}
                      >
                        {detailsCta.label}
                        <ChevronRight size={17} aria-hidden="true" />
                      </button>
                    )}
                    {!started && (
                      <p className="start-intro">
                        Follow the prepared stops in order, with room to pause
                        along the way.
                      </p>
                    )}
                    {nextStop && (
                      <button
                        className="next-step stop-open"
                        onClick={() => setDetail(nextStop.id)}
                      >
                        <span className="next-arrow">
                          <ArrowRight size={21} />
                        </span>
                        <div>
                          <p className="eyebrow">
                            NEXT{' '}
                            {isSightseeingStop(nextStop) &&
                              nextStop.priority === 'optional' && (
                                <span className="inline-optional">
                                  ◇ OPTIONAL
                                </span>
                              )}
                          </p>
                          <h3>
                            {nextStop.name}
                            {nextPlanItem?.plannedStartTime && (
                              <time dateTime={nextPlanItem.plannedStartTime}>
                                {' '}
                                · {nextPlanItem.plannedStartTime}
                              </time>
                            )}
                          </h3>
                          <p>
                            {nextLeg ? (
                              <>
                                <Mode mode={nextLeg.mode} />
                                Prepared {nextLeg.mode} leg
                                {nextLeg.plannedDurationMinutes !== undefined &&
                                  ` · ${nextLeg.plannedDurationMinutes} min`}
                              </>
                            ) : (
                              'Travel details unavailable'
                            )}
                          </p>
                        </div>
                        <ChevronRight size={19} />
                      </button>
                    )}
                    <div className="actions">
                      {!started
                        ? firstPreparedStop?.logisticsRole !== 'start' && (
                            <button
                              className="secondary"
                              onClick={beginDayAndNavigate}
                            >
                              <Navigation size={20} /> Start &amp; navigate
                            </button>
                          )
                        : currentActionModel?.actions.navigate &&
                          navigationUrl && (
                            <a className="secondary" href={navigationUrl}>
                              <Navigation size={20} /> Navigate
                            </a>
                          )}
                      <button
                        className="primary"
                        onClick={started ? done : beginDay}
                      >
                        {started ? (
                          <Check size={21} />
                        ) : (
                          <ArrowRight size={21} />
                        )}{' '}
                        {started
                          ? currentActionModel?.completionLabel
                          : 'Start day'}
                      </button>
                    </div>
                    <p className="action-context">
                      {started
                        ? `${currentActionModel?.completionLabel ?? 'Done'} completes ${displayedStop.name}.`
                        : firstPreparedStop?.logisticsRole === 'start'
                          ? 'Start Day begins at this start point.'
                          : 'Start Day stays in RouteRunner. Start & navigate also opens Google Maps.'}
                    </p>
                    {started && (
                      <button
                        type="button"
                        className="end-day-action"
                        onClick={requestEndDay}
                      >
                        <Flag size={16} /> End Day
                      </button>
                    )}
                  </>
                ) : null}
                {day.hardEndTime &&
                  !lifecycleComplete &&
                  !isReadOnlyPreview && (
                    <div className="deadline">
                      <span>
                        <Flag size={15} />
                        Hard stop <strong>{day.hardEndTime}</strong>
                      </span>
                      <span>
                        {scheduleProjection.status === 'calculable'
                          ? `Estimated finish ${formatProjectedTime(scheduleProjection.estimatedFinishAt, trip.timeZone)}`
                          : scheduleProjection.status === 'unavailable'
                            ? 'Schedule estimate unavailable'
                            : 'Projection begins after Start Day'}
                      </span>
                    </div>
                  )}
              </section>
              {!isReadOnlyPreview && waitingDoNowModels.length > 0 && (
                <section className="do-now-queue" aria-label="Queued for now">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">QUEUED FOR NOW</p>
                      <h2>After Current</h2>
                    </div>
                    <ListOrdered size={20} aria-hidden="true" />
                  </div>
                  <ol>
                    {waitingDoNowModels.map((model) => {
                      const stop = trip.stops.find(
                        (candidate) => candidate.id === model.stopId,
                      );
                      if (!stop) return null;
                      return (
                        <li key={stop.id}>
                          <button
                            type="button"
                            onClick={() => setDetail(stop.id)}
                          >
                            <span>{model.queuePosition}</span>
                            <div>
                              <strong>{stop.name}</strong>
                              <small>Queued for now · FIFO</small>
                            </div>
                            <ChevronRight size={17} />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
              {endDayResolutionOpen && !isReadOnlyPreview && (
                <section
                  className="end-day-resolution"
                  aria-label="End Day remaining work"
                >
                  <strong>Resolve remaining work</strong>
                  <p>
                    Save every remaining scheduled stop for later, or keep the
                    day open and review stops individually.
                  </p>
                  <div className="end-day-resolution-actions">
                    <button type="button" onClick={saveAllForLaterAndCloseDay}>
                      Save all for later
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEndDayResolutionOpen(false);
                        setFeedback('Day remains open for individual review.');
                      }}
                    >
                      Review individually
                    </button>
                    <button
                      type="button"
                      onClick={() => setEndDayResolutionOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              )}
              {switchResolutionTargetDayId && (
                <section
                  className="end-day-resolution"
                  aria-label="Execution day remaining work"
                >
                  <strong>{feedback}</strong>
                  <p>
                    Resolve the current day before starting the next planned
                    day.
                  </p>
                  <div className="end-day-resolution-actions">
                    <button
                      type="button"
                      onClick={() =>
                        requestExecutionDaySwitch(
                          switchResolutionTargetDayId,
                          'save_all_for_later',
                        )
                      }
                    >
                      Save all for later
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSwitchResolutionTargetDayId(undefined);
                        returnToExecutionView();
                        setFeedback('Day remains open for individual review.');
                      }}
                    >
                      Review individually
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwitchResolutionTargetDayId(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              )}
              {!isReadOnlyPreview &&
                recommendation &&
                recommendationStop &&
                day.hardEndTime && (
                  <section
                    className="recommendation"
                    aria-label="Schedule recommendation"
                  >
                    <strong className="recommendation-title">
                      <span className="optional-diamond" aria-hidden="true">
                        ◇
                      </span>
                      {recommendation.severity === 'DEADLINE_AT_RISK'
                        ? 'Deadline at risk'
                        : 'Schedule tight'}
                    </strong>
                    <p>
                      <strong>
                        {formatBufferAmount(recommendation.bufferMinutes)}
                      </strong>
                      <br />
                      {recommendation.message ??
                        `Skip ${recommendationStop.shortName ?? recommendationStop.name}, the prepared fallback for this schedule.`}
                      <br />
                      {recommendation.bufferMinutes >= 0
                        ? `Only ${Math.floor(recommendation.bufferMinutes)} min remain before the ${day.hardEndTime} hard stop.`
                        : `Projected finish is ${Math.ceil(Math.abs(recommendation.bufferMinutes))} min past the ${day.hardEndTime} hard stop.`}{' '}
                      The choice is yours.
                    </p>
                    <div className="recommendation-actions">
                      <button type="button" onClick={acceptRecommendation}>
                        Skip{' '}
                        {recommendationStop.shortName ??
                          recommendationStop.name}
                      </button>
                      <button type="button" onClick={keepRecommendation}>
                        Keep it
                      </button>
                    </div>
                    <span>Prepared rule · no automatic change</span>
                  </section>
                )}
              {constraintAlerts.map((alert) => {
                const alertStop = trip.stops.find(
                  (stop) => stop.id === alert.stopId,
                );
                if (!alertStop) return null;
                return (
                  <aside className="risk-note" key={alert.stopId}>
                    <Clock size={18} aria-hidden="true" />
                    <p>
                      <strong>{alertStop.name}</strong>
                      <br />
                      {alert.type === 'fixed_time_late'
                        ? `Projected ${Math.ceil(alert.latenessMinutes)} min late`
                        : `Projected arrival ${Math.ceil(alert.latenessMinutes)} min after window`}
                    </p>
                  </aside>
                );
              })}
              <output
                className={`feedback ${feedback ? 'has-feedback' : ''}`}
                aria-live="polite"
              >
                {feedback}
              </output>
              <section className="itinerary" aria-label="Full day itinerary">
                <div className="section-heading">
                  <h2>Your day</h2>
                  <span>
                    {completed} of {dayPlanModel.length} execution items
                    complete
                  </span>
                </div>
                <ol>
                  {dayPlanModel.map(
                    ({ stop, plannedStartTime, markerLabel }, planIndex) => {
                      const status = presentationStatus(stop.id);
                      const previousStop = dayPlanModel[planIndex - 1]?.stop;
                      const travel = preparedLeg(previousStop, stop);
                      return (
                        <li
                          key={stop.id}
                          className={`itinerary-item ${status}`}
                        >
                          {planIndex > 0 &&
                            status !== 'skipped' &&
                            status !== 'saved' &&
                            travel && (
                              <div className="transit-row">
                                <Mode mode={travel.mode} size={14} />
                                <span>
                                  Prepared {travel.mode} leg
                                  {travel.plannedDurationMinutes !==
                                    undefined &&
                                    ` · ${travel.plannedDurationMinutes} min`}
                                </span>
                              </div>
                            )}
                          <button
                            className="itinerary-stop"
                            onClick={() => setDetail(stop.id)}
                            aria-label={`${stop.name}, ${status}, ${stopSemanticLabel(stop)}`}
                          >
                            <span
                              className={`stop-number ${stop.priority === 'optional' ? 'optional-number' : ''}`}
                            >
                              {status === 'completed' ? (
                                <Check size={17} />
                              ) : status === 'skipped' ? (
                                '−'
                              ) : status === 'saved' ? (
                                '◇'
                              ) : (
                                markerLabel
                              )}
                            </span>
                            {plannedStartTime && (
                              <time
                                className="itinerary-planned-time"
                                dateTime={plannedStartTime}
                              >
                                {plannedStartTime}
                              </time>
                            )}
                            <div>
                              <strong>{stop.name}</strong>
                              <span>
                                {status === 'skipped'
                                  ? 'Skipped'
                                  : status === 'saved'
                                    ? 'Saved for later'
                                    : status === 'queued'
                                      ? `Queued for now · position ${deriveStopActionModel(trip, execution, stop.id)?.queuePosition}`
                                      : status === 'completed'
                                        ? modelStopHistory(stop.id)
                                            ?.completedEarly
                                          ? `Visited on ${modelStopHistory(stop.id)?.completedOnDayLabel ?? 'another day'}`
                                          : 'Visited'
                                        : `${stop.plannedVisitMinutes} min · ${stopSemanticLabel(stop)}`}
                              </span>
                            </div>
                            {status === 'current' ? (
                              <b className="status-tag">NOW</b>
                            ) : status === 'next' ? (
                              <b className="status-tag next-tag">NEXT</b>
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </button>
                        </li>
                      );
                    },
                  )}
                </ol>
                <div className="itinerary-end">
                  <Flag size={19} />
                  <div>
                    <strong>
                      {day.hardEndTime
                        ? `${day.hardEndTime} · Sightseeing ends`
                        : 'Prepared route ends'}
                    </strong>
                    <span>
                      {day.postDayDestination
                        ? `${day.postDayDestination.name} after sightseeing · static plan`
                        : `Final stop · ${dayPlanModel.at(-1)?.stop.name ?? 'Unavailable'}`}
                    </span>
                  </div>
                  {day.postDayDestination ? (
                    <Plane size={19} />
                  ) : (
                    <MapPin size={19} />
                  )}
                </div>
              </section>
              {forLaterModels.length > 0 && (
                <section className="for-later" aria-label="For later">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">TRIP-LEVEL</p>
                      <h2>For later</h2>
                    </div>
                    <span>{forLaterModels.length} pending</span>
                  </div>
                  <p className="for-later-intro">
                    Unscheduled stops kept outside the active route.
                  </p>
                  <ul>
                    {forLaterModels.map((model) => {
                      const stop = trip.stops.find(
                        (candidate) => candidate.id === model.stopId,
                      );
                      const originalDay = overview.days.find((candidate) =>
                        candidate.stops.some(
                          (planned) => planned.stopId === model.stopId,
                        ),
                      );
                      if (!stop) return null;
                      return (
                        <li key={stop.id}>
                          <button
                            type="button"
                            onClick={() => setDetail(stop.id)}
                          >
                            <div>
                              <strong>{stop.name}</strong>
                              <small>
                                {originalDay
                                  ? `Originally ${originalDay.label}`
                                  : 'Not assigned to a planned day'}
                              </small>
                            </div>
                            <ChevronRight size={17} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
        <footer>
          <span className="footer-brand">RouteRunner</span>
          <p>Your AI plans. RouteRunner executes.</p>
          <small>
            Local browser execution · foreground location · prepared route only
          </small>
        </footer>
      </main>
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="fullscreen-map" showCloseButton={false}>
          <DialogTitle className="sr-only">
            {trip.title} itinerary map
          </DialogTitle>
          <DialogDescription className="sr-only">
            Full geographic itinerary map. Closing returns to the unchanged
            execution state.
          </DialogDescription>
          <div className="full-map-body">
            <RouteMap
              view={mapView}
              location={location}
              onStop={setDetail}
              full
            />
          </div>
          <DialogClose className="full-map-back">
            <ArrowLeft size={20} />
            Back to day
          </DialogClose>
        </DialogContent>
      </Dialog>
      <Sheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="stop-sheet"
        >
          {detail !== null && detailStop && (
            <>
              <div className="sheet-top">
                <span className="eyebrow">
                  {detailPlannedDay
                    ? detailStop.logisticsRole
                      ? `${detailPlannedDay.label.toUpperCase()} · ${stopSemanticLabel(detailStop).toUpperCase()}`
                      : `${detailPlannedDay.label.toUpperCase()} · STOP ${detailHistory?.sightseeingPosition ?? '—'} OF ${detailPlannedDay.sightseeingStopCount}`
                    : 'TRIP STOP'}{' '}
                  · {detailActionModel?.statusLabel.toUpperCase()}
                  {detailActionModel?.queuePosition
                    ? ` · QUEUE ${detailActionModel.queuePosition}`
                    : ''}
                </span>
                <SheetClose
                  className="sheet-close"
                  aria-label="Close stop details"
                >
                  <X size={22} />
                </SheetClose>
              </div>
              <SheetTitle className="detail-title">
                {detailStop.name}
              </SheetTitle>
              <SheetDescription className="detail-description">
                {detailStop.plannedVisitMinutes} min
                {' · '}
                {stopSemanticLabel(detailStop)}
                {detailPlanItem?.plannedStartTime && (
                  <>
                    {' · Planned '}
                    <time dateTime={detailPlanItem.plannedStartTime}>
                      {detailPlanItem.plannedStartTime}
                    </time>
                  </>
                )}
                {detailHistory?.completedEarly && (
                  <>
                    {' · Visited on '}
                    {detailHistory.completedOnDayLabel}
                  </>
                )}
                {detailActionModel?.role === 'waiting_do_now' && (
                  <> · Doing today under the active execution day</>
                )}
              </SheetDescription>
              <StopVisitContent stop={detailStop} surface="details" />
              {detailStop.id === copenhagenStopIds.kastellet && (
                <figure className="stop-photo">
                  {/* oxlint-disable-next-line next/no-img-element -- fixed credited Wikimedia fixture image */}
                  <img
                    src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Kastellet_aerial.jpg/1280px-Kastellet_aerial.jpg"
                    alt="Aerial view of Kastellet’s star-shaped green ramparts and moat in Copenhagen."
                  />
                  <figcaption>
                    <a
                      href="https://commons.wikimedia.org/wiki/File:Kastellet_aerial.jpg"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CucombreLibre / Wikimedia
                    </a>{' '}
                    ·{' '}
                    <a
                      href="https://creativecommons.org/licenses/by/2.0/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CC BY 2.0
                    </a>{' '}
                    · cropped
                  </figcaption>
                </figure>
              )}
              {!isReadOnlyPreview &&
                started &&
                detail === execution.currentStopId &&
                nextStop && (
                  <div className="detail-next">
                    <ArrowRight size={20} />
                    <div>
                      <span>After this</span>
                      <strong>{nextStop.name}</strong>
                    </div>
                  </div>
                )}
              <div className="actions">
                {detailActionModel?.actions.cancelDoNow && (
                  <button className="primary" onClick={cancelSelectedDoNow}>
                    <X size={20} /> Cancel Do Now
                  </button>
                )}
                {detailActionModel?.actions.doNow && (
                  <button className="primary" onClick={doNowSelectedStop}>
                    <ArrowRight size={20} /> Do now
                  </button>
                )}
                {detailActionModel?.actions.alreadyVisited && (
                  <button
                    className="secondary"
                    onClick={markSelectedAlreadyVisited}
                  >
                    <Check size={20} /> Already visited
                  </button>
                )}
                {!isReadOnlyPreview &&
                  lifecycle.status === 'READY' &&
                  detail === firstPreparedStopId && (
                    <button
                      className="primary"
                      onClick={() => {
                        beginDay();
                        setDetail(null);
                      }}
                    >
                      <ArrowRight size={20} /> Start day
                    </button>
                  )}
                {detailActionModel?.actions.done && current && (
                  <>
                    {detailActionModel.actions.navigate && navigationUrl && (
                      <a className="secondary" href={navigationUrl}>
                        <Navigation size={20} /> Navigate
                      </a>
                    )}
                    <button className="primary" onClick={done}>
                      <Check size={20} /> {detailActionModel.completionLabel}
                    </button>
                  </>
                )}
                {!detailActionModel?.actions.done && (
                  <SheetClose className="primary">
                    {isReadOnlyPreview ? 'Back to preview' : 'Back to day'}
                  </SheetClose>
                )}
              </div>
              {detailActionModel?.actions.done && current && (
                <div className="sheet-secondary-actions">
                  {detailActionModel.actions.skip && (
                    <button onClick={skip}>Skip</button>
                  )}
                  {detailActionModel.actions.saveForLater && (
                    <button onClick={saveCurrentForLater}>
                      Save for later
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
