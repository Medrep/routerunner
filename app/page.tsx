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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import RouteMap from '@/components/routerunner/route-map';
import { stopDetailsCtaModel } from '@/components/routerunner/stop-visit-content';
import { StopVisitContent } from '@/components/routerunner/stop-visit-content-view';
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
  const [trip] = useState(() => selectTripFromSearch(window.location.search));
  const day = trip.days[0];
  const orderedPlan = orderedDayPlan(day);
  const [execution, setExecution] = useState<TripExecutionState>(
    () => restoreOrCreateExecutionState(trip, new Date().toISOString()).state,
  );
  const [full, setFull] = useState(false);
  const [detail, setDetail] = useState<StopId | null>(null);
  const [feedback, setFeedback] = useState('');
  const initialExecution = useRef(execution);
  const selectedTripOption = selectableTrips.find(
    ({ trip: optionTrip }) => optionTrip.id === trip.id,
  )!;

  useEffect(() => {
    saveExecutionState(
      trip,
      initialExecution.current,
      initialExecution.current.lastUpdatedAt,
    );
  }, [trip]);

  const started = execution.executionDayId !== undefined;
  const location = useForegroundLocation(started);
  const current =
    trip.stops.find((stop) => stop.id === execution.currentStopId) ?? null;
  const firstPreparedStopId = orderedPlan[0]?.stopId;
  const firstPreparedStop = trip.stops.find(
    (stop) => stop.id === firstPreparedStopId,
  );
  const displayedStop = current ?? (!started ? firstPreparedStop : undefined);
  const detailsCta = displayedStop ? stopDetailsCtaModel(displayedStop) : null;
  const nextStopId = started
    ? nextEligiblePendingStopId(trip, execution)
    : orderedPlan[1]?.stopId;
  const nextStop = trip.stops.find((stop) => stop.id === nextStopId) ?? null;
  const detailStop = trip.stops.find((stop) => stop.id === detail) ?? null;
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
        trip,
        execution,
        location.status === 'available' ? location.coordinates : undefined,
      ),
    [execution, location, trip],
  );
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
    setExecution(persisted.state);
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
    apply(
      skipCurrentStop(trip, execution, new Date().toISOString()),
      (state) => {
        const promoted = trip.stops.find(
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
          <div className="day-chip">
            <MapPin size={14} />
            {trip.city}
          </div>
        </header>
        <section className="trip-heading">
          <div>
            <p className="eyebrow">ONE DAY · {trip.stops.length} STOPS</p>
            <h1>
              {trip.title}
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
              {day.hardEndTime && (
                <div className="deadline">
                  <span>
                    <Flag size={15} />
                    Hard stop <strong>{day.hardEndTime}</strong>
                  </span>
                  <span>Static plan only</span>
                </div>
              )}
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
                  {completed} of {trip.stops.length} visited
                </span>
              </div>
              <ol>
                {orderedPlan.map((item, planIndex) => {
                  const stop = trip.stops.find(
                    (candidate) => candidate.id === item.stopId,
                  )!;
                  const status = presentationStatus(stop.id);
                  const previousItem = orderedPlan[planIndex - 1];
                  const previousStop = previousItem
                    ? trip.stops.find(
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
                  <strong>
                    {day.hardEndTime
                      ? `${day.hardEndTime} · Sightseeing ends`
                      : 'Prepared route ends'}
                  </strong>
                  <span>
                    {day.postDayDestination
                      ? `${day.postDayDestination.name} after sightseeing · static plan`
                      : `Final stop · ${trip.stops.at(-1)?.name ?? 'Unavailable'}`}
                  </span>
                </div>
                {day.postDayDestination ? (
                  <Plane size={19} />
                ) : (
                  <MapPin size={19} />
                )}
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
                  STOP {planNumber(detailStop.id) ?? '—'} OF {trip.stops.length}{' '}
                  · {presentationStatus(detailStop.id).toUpperCase()}
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
              <StopVisitContent stop={detailStop} surface="details" />
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
