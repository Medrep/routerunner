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
  Check,
  ChevronRight,
  Clock,
  Expand,
  Flag,
  Footprints,
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
import RouteMap from '@/components/routerunner/route-map';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { copenhagenStopIds, copenhagenTrip } from '@/data/trips/copenhagen';
import { useForegroundLocation } from '@/hooks/use-foreground-location';
import {
  completeCurrentStop,
  currentGoogleMapsNavigationUrl,
  deriveRouteMapView,
  nextEligiblePendingStopId,
  orderedDayPlan,
  persistExecutionTransition,
  restoreOrCreateExecutionState,
  saveCurrentForLater as saveCurrentForLaterTransition,
  saveExecutionState,
  skipCurrentStop,
  startDayAndBuildNavigation,
  type RouteMapStopStatus,
  type Stop,
  type StopId,
  type TransitionResult,
  type TravelMode,
  type TripExecutionState,
} from '@/domain';

type PresentationStatus = RouteMapStopStatus;

const day = copenhagenTrip.days[0];
const orderedPlan = orderedDayPlan(day);
function Mode({ mode, size = 16 }: { mode: TravelMode; size?: number }) {
  return mode === 'ferry' ? (
    <Ship size={size} />
  ) : mode === 'transit' ? (
    <TrainFront size={size} />
  ) : (
    <Footprints size={size} />
  );
}

function priorityLabel(stop: Stop) {
  if (stop.priority === 'must') return 'Must-see';
  if (stop.priority === 'optional') return 'Optional';
  return 'Part of your route';
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
  const [execution, setExecution] = useState<TripExecutionState>(
    () =>
      restoreOrCreateExecutionState(copenhagenTrip, new Date().toISOString())
        .state,
  );
  const [full, setFull] = useState(false);
  const [detail, setDetail] = useState<StopId | null>(null);
  const [feedback, setFeedback] = useState('');
  const initialExecution = useRef(execution);

  useEffect(() => {
    saveExecutionState(
      copenhagenTrip,
      initialExecution.current,
      initialExecution.current.lastUpdatedAt,
    );
  }, []);

  const started = execution.executionDayId !== undefined;
  const location = useForegroundLocation(started);
  const current =
    copenhagenTrip.stops.find((stop) => stop.id === execution.currentStopId) ??
    null;
  const firstPreparedStopId = orderedPlan[0]?.stopId;
  const firstPreparedStop = copenhagenTrip.stops.find(
    (stop) => stop.id === firstPreparedStopId,
  );
  const displayedStop = current ?? (!started ? firstPreparedStop : undefined);
  const nextStopId = started
    ? nextEligiblePendingStopId(copenhagenTrip, execution)
    : orderedPlan[1]?.stopId;
  const nextStop =
    copenhagenTrip.stops.find((stop) => stop.id === nextStopId) ?? null;
  const detailStop =
    copenhagenTrip.stops.find((stop) => stop.id === detail) ?? null;
  const completed = Object.values(execution.stopExecutions).filter(
    (stopExecution) => stopExecution.status === 'completed',
  ).length;
  const noAvailableCurrent = started && current === null;

  function planNumber(stopId: StopId): number | undefined {
    const index = orderedPlan.findIndex((item) => item.stopId === stopId);
    return index < 0 ? undefined : index + 1;
  }

  function presentationStatus(stopId: StopId): PresentationStatus {
    const stopExecution = execution.stopExecutions[stopId];
    if (execution.currentStopId === stopId) return 'current';
    if (nextStopId === stopId && started) return 'next';
    if (stopExecution.status === 'completed') return 'completed';
    if (stopExecution.status === 'skipped') return 'skipped';
    if (
      stopExecution.status === 'pending' &&
      stopExecution.scheduledDayId === null
    )
      return 'saved';
    return 'future';
  }

  const mapView = useMemo(
    () =>
      deriveRouteMapView(
        copenhagenTrip,
        execution,
        location.status === 'available' ? location.coordinates : undefined,
      ),
    [execution, location],
  );
  const navigationUrl = currentGoogleMapsNavigationUrl(
    copenhagenTrip,
    execution,
  );

  function apply(
    result: TransitionResult,
    message: (state: TripExecutionState) => string,
  ) {
    const persisted = persistExecutionTransition(
      copenhagenTrip,
      execution,
      result,
    );
    if (persisted.status === 'rejected') {
      setFeedback(persisted.error.message);
      return;
    }
    setExecution(persisted.state);
    setFeedback(message(persisted.state));
  }

  function beginDayTransition() {
    const result = startDayAndBuildNavigation(
      copenhagenTrip,
      execution,
      day.id,
      new Date().toISOString(),
    );
    if (result.status === 'rejected') {
      setFeedback(result.result.error.message);
      return result;
    }
    setExecution(result.result.state);
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

  function done() {
    if (!current) return;
    const completedName = current.name;
    apply(
      completeCurrentStop(copenhagenTrip, execution, new Date().toISOString()),
      (state) => {
        const promoted = copenhagenTrip.stops.find(
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
    apply(
      skipCurrentStop(copenhagenTrip, execution, new Date().toISOString()),
      (state) => {
        const promoted = copenhagenTrip.stops.find(
          (stop) => stop.id === state.currentStopId,
        );
        return promoted
          ? `${skippedName} skipped. ${promoted.name} is now Current.`
          : `${skippedName} skipped. No Current remains.`;
      },
    );
    setDetail(null);
  }

  function saveCurrentForLater() {
    if (!current) return;
    const savedName = current.name;
    apply(
      saveCurrentForLaterTransition(
        copenhagenTrip,
        execution,
        new Date().toISOString(),
      ),
      (state) => {
        const promoted = copenhagenTrip.stops.find(
          (stop) => stop.id === state.currentStopId,
        );
        return promoted
          ? `${savedName} saved for later. ${promoted.name} is now Current.`
          : `${savedName} saved for later. No Current remains.`;
      },
    );
    setDetail(null);
  }

  function preparedLeg(
    from: Stop | undefined | null,
    to: Stop | undefined | null,
  ) {
    if (!from || !to) return undefined;
    return copenhagenTrip.legs?.find(
      (candidate) =>
        candidate.fromStopId === from.id && candidate.toStopId === to.id,
    );
  }

  const nextLeg = preparedLeg(displayedStop, nextStop);

  return (
    <>
      <main className="prototype">
        <div className="prototype-bar">
          <span>
            PRODUCTION EXECUTION <b>LOCAL</b>
          </span>
          <span>Schedule projection unavailable</span>
        </div>
        <header className="brand">
          <div className="brand-mark">
            <Route size={23} strokeWidth={2.4} />
          </div>
          <strong>RouteRunner</strong>
          <span>YOUR DAY. ONE CLEAR NEXT STEP.</span>
          <div className="day-chip">
            <MapPin size={14} />
            {copenhagenTrip.city}
          </div>
        </header>
        <section className="trip-heading">
          <div>
            <p className="eyebrow">
              ONE DAY · {copenhagenTrip.stops.length} STOPS
            </p>
            <h1>
              {copenhagenTrip.title}
              <span className="heading-dot">.</span>
            </h1>
          </div>
          <div className="schedule">
            <strong>
              <i />
              Schedule unavailable
            </strong>
            <span>Live projection comes in a later slice</span>
          </div>
        </section>
        <div className="workspace">
          <div className="map-column">
            <section className="map-panel">
              <RouteMap view={mapView} location={location} onStop={setDetail} />
              <button className="map-expand" onClick={() => setFull(true)}>
                <Expand size={17} />
                Full map
              </button>
            </section>
            <div className="map-day-note">
              <Flag size={18} />
              <p>
                A day on your terms.
                <span>Follow the route. Leave room for the city.</span>
              </p>
            </div>
          </div>
          <div className="day-column">
            <section className="execution" aria-label="Current step">
              <div className="execution-top">
                <span className="active-label">
                  {current ? 'NOW' : started ? 'NO CURRENT' : 'FIRST STOP'}
                </span>
                <span className="current-time">
                  <Clock size={14} />
                  {started ? 'Day active' : 'Not started'}
                </span>
              </div>
              {noAvailableCurrent ? (
                <div className="finished">
                  <div className="finish-check">
                    <Check size={28} />
                  </div>
                  <h2>No Current remains</h2>
                  <p>
                    Available work is exhausted. The day remains active until a
                    later slice adds explicit End Day behavior.
                  </p>
                </div>
              ) : displayedStop ? (
                <>
                  <button
                    className="now stop-open"
                    onClick={() => setDetail(displayedStop.id)}
                  >
                    <span className="big-number">
                      {planNumber(displayedStop.id) ?? '—'}
                    </span>
                    <div>
                      <h2>{displayedStop.name}</h2>
                      <p>
                        {started ? 'Explore' : 'Your day begins here'} · ~
                        {displayedStop.plannedVisitMinutes} min
                      </p>
                    </div>
                    <ChevronRight size={22} />
                  </button>
                  {!started && (
                    <p className="start-intro">
                      A waterfront morning, a walk through the city, and a
                      little room to wander.
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
                          {nextStop.priority === 'optional' && (
                            <span className="inline-optional">◇ OPTIONAL</span>
                          )}
                        </p>
                        <h3>{nextStop.name}</h3>
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
                    {!started ? (
                      <button
                        className="secondary"
                        onClick={beginDayAndNavigate}
                      >
                        <Navigation size={20} /> Start &amp; navigate
                      </button>
                    ) : (
                      navigationUrl && (
                        <a className="secondary" href={navigationUrl}>
                          <Navigation size={20} /> Navigate
                        </a>
                      )
                    )}
                    <button
                      className="primary"
                      onClick={started ? done : beginDay}
                    >
                      {started ? <Check size={21} /> : <ArrowRight size={21} />}{' '}
                      {started ? 'Done' : 'Start day'}
                    </button>
                  </div>
                  <p className="action-context">
                    {started
                      ? `Done completes ${displayedStop.name}.`
                      : 'Start Day stays in RouteRunner. Start & navigate also opens Google Maps.'}
                  </p>
                </>
              ) : null}
              <div className="deadline">
                <span>
                  <Flag size={15} />
                  Hard stop <strong>{day.hardEndTime}</strong>
                </span>
                <span>Static plan only</span>
              </div>
            </section>
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
                  {completed} of {copenhagenTrip.stops.length} visited
                </span>
              </div>
              <ol>
                {orderedPlan.map((item, planIndex) => {
                  const stop = copenhagenTrip.stops.find(
                    (candidate) => candidate.id === item.stopId,
                  )!;
                  const status = presentationStatus(stop.id);
                  const previousItem = orderedPlan[planIndex - 1];
                  const previousStop = previousItem
                    ? copenhagenTrip.stops.find(
                        (candidate) => candidate.id === previousItem.stopId,
                      )
                    : undefined;
                  const travel = preparedLeg(previousStop, stop);
                  return (
                    <li key={stop.id} className={`itinerary-item ${status}`}>
                      {planIndex > 0 &&
                        status !== 'skipped' &&
                        status !== 'saved' &&
                        travel && (
                          <div className="transit-row">
                            <Mode mode={travel.mode} size={14} />
                            <span>
                              Prepared {travel.mode} leg
                              {travel.plannedDurationMinutes !== undefined &&
                                ` · ${travel.plannedDurationMinutes} min`}
                            </span>
                          </div>
                        )}
                      <button
                        className="itinerary-stop"
                        onClick={() => setDetail(stop.id)}
                        aria-label={`${stop.name}, ${status}, ${stop.priority}`}
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
                            planIndex + 1
                          )}
                        </span>
                        <div>
                          <strong>{stop.name}</strong>
                          <span>
                            {status === 'skipped'
                              ? 'Skipped'
                              : status === 'saved'
                                ? 'Saved for later'
                                : status === 'completed'
                                  ? 'Visited'
                                  : `${stop.plannedVisitMinutes} min · ${priorityLabel(stop)}`}
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
                })}
              </ol>
              <div className="itinerary-end">
                <Flag size={19} />
                <div>
                  <strong>{day.hardEndTime} · Sightseeing ends</strong>
                  <span>Airport after sightseeing · static plan</span>
                </div>
                <Plane size={19} />
              </div>
            </section>
          </div>
        </div>
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
            {copenhagenTrip.title} itinerary map
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
                  STOP {planNumber(detailStop.id) ?? '—'} OF{' '}
                  {copenhagenTrip.stops.length} ·{' '}
                  {presentationStatus(detailStop.id).toUpperCase()}
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
                {detailStop.plannedVisitMinutes} min to explore
                {' · '}
                {priorityLabel(detailStop)}
              </SheetDescription>
              {detailStop.id === copenhagenStopIds.kastellet && (
                <figure className="stop-photo">
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
              <p className="stop-note">
                This stop remains in the immutable Copenhagen plan. Runtime
                actions update only its trip execution state.
              </p>
              {started && detail === execution.currentStopId && nextStop && (
                <div className="detail-next">
                  <ArrowRight size={20} />
                  <div>
                    <span>After this</span>
                    <strong>{nextStop.name}</strong>
                  </div>
                </div>
              )}
              <div className="actions">
                {!started && detail === firstPreparedStopId && (
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
                {started && detail === execution.currentStopId && current && (
                  <>
                    {navigationUrl && (
                      <a className="secondary" href={navigationUrl}>
                        <Navigation size={20} /> Navigate
                      </a>
                    )}
                    <button className="primary" onClick={done}>
                      <Check size={20} /> Done
                    </button>
                  </>
                )}
                {(detail !== execution.currentStopId || !started) && (
                  <SheetClose className="primary">Back to day</SheetClose>
                )}
              </div>
              {started && detail === execution.currentStopId && current && (
                <div className="sheet-secondary-actions">
                  {current.canSkip && <button onClick={skip}>Skip</button>}
                  <button onClick={saveCurrentForLater}>Save for later</button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
