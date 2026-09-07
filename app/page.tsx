'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
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
import RouteMap, {
  type RouteMapState,
  type RouteMapStop,
} from '@/components/routerunner/route-map';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { copenhagenStopIds, copenhagenTrip } from '@/data/trips/copenhagen';
import {
  completeCurrentStop,
  nextEligiblePendingStopId,
  orderedDayPlan,
  restoreOrCreateExecutionState,
  saveCurrentForLater as saveCurrentForLaterTransition,
  saveExecutionState,
  skipCurrentStop,
  startDay,
  type Stop,
  type StopId,
  type TransitionResult,
  type TravelMode,
  type TripExecutionState,
} from '@/domain';

type PresentationStatus = NonNullable<RouteMapState['statuses']>[number];

const day = copenhagenTrip.days[0];
const orderedPlan = orderedDayPlan(day);
const mapPositions = [
  { x: 215, y: 374 },
  { x: 232, y: 285 },
  { x: 171, y: 249 },
  { x: 247, y: 161 },
  { x: 316, y: 111 },
  { x: 449, y: 174 },
  { x: 367, y: 428 },
] as const;

const mapStops: RouteMapStop[] = copenhagenTrip.stops.map((stop, index) => ({
  name: stop.name,
  kind: stop.priority === 'optional' ? 'optional' : stop.priority,
  ...mapPositions[index],
}));

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
  const [detail, setDetail] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    saveExecutionState(copenhagenTrip, execution, execution.lastUpdatedAt);
  }, [execution]);

  const started = execution.executionDayId !== undefined;
  const currentIndex = execution.currentStopId
    ? copenhagenTrip.stops.findIndex(
        (stop) => stop.id === execution.currentStopId,
      )
    : -1;
  const current = currentIndex >= 0 ? copenhagenTrip.stops[currentIndex] : null;
  const firstPreparedStopId = orderedPlan[0]?.stopId;
  const firstPreparedStop = copenhagenTrip.stops.find(
    (stop) => stop.id === firstPreparedStopId,
  );
  const displayedStop = current ?? (!started ? firstPreparedStop : undefined);
  const nextStopId = started
    ? nextEligiblePendingStopId(copenhagenTrip, execution)
    : orderedPlan[1]?.stopId;
  const nextIndex = nextStopId
    ? copenhagenTrip.stops.findIndex((stop) => stop.id === nextStopId)
    : -1;
  const nextStop = nextIndex >= 0 ? copenhagenTrip.stops[nextIndex] : null;
  const completed = Object.values(execution.stopExecutions).filter(
    (stopExecution) => stopExecution.status === 'completed',
  ).length;
  const noAvailableCurrent = started && current === null;

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

  const statuses = copenhagenTrip.stops.map((stop) =>
    presentationStatus(stop.id),
  );
  const mapState: RouteMapState = {
    current: currentIndex,
    started,
    skipped:
      execution.stopExecutions[
        copenhagenTrip.stops.find((stop) => stop.name === 'Reffen')!.id
      ].status === 'skipped',
    saved: statuses.flatMap((status, index) =>
      status === 'saved' ? [index] : [],
    ),
    ended: false,
    statuses,
  };

  function apply(
    result: TransitionResult,
    message: (state: TripExecutionState) => string,
  ) {
    if (!result.ok) {
      setFeedback(result.error.message);
      return;
    }
    setExecution(result.state);
    setFeedback(message(result.state));
  }

  function beginDay() {
    apply(
      startDay(copenhagenTrip, execution, day.id, new Date().toISOString()),
      () => `${firstPreparedStop?.name ?? 'The first stop'} is now Current.`,
    );
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
              <RouteMap
                stops={mapStops}
                trip={mapState}
                onStop={setDetail}
                showCurrentPosition={false}
              />
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
                    onClick={() =>
                      setDetail(
                        copenhagenTrip.stops.findIndex(
                          (stop) => stop.id === displayedStop.id,
                        ),
                      )
                    }
                  >
                    <span className="big-number">
                      {copenhagenTrip.stops.findIndex(
                        (stop) => stop.id === displayedStop.id,
                      ) + 1}
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
                      onClick={() => setDetail(nextIndex)}
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
                    {!started && (
                      <button className="secondary" disabled>
                        Navigation coming later
                      </button>
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
                      : 'Start Day creates Current. Navigation is not enabled yet.'}
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
                  const stopIndex = copenhagenTrip.stops.findIndex(
                    (candidate) => candidate.id === stop.id,
                  );
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
                        onClick={() => setDetail(stopIndex)}
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
            Local browser execution · schedule projection, live routing and GPS
            are not available yet.
          </small>
        </footer>
      </main>
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="fullscreen-map" showCloseButton={false}>
          <div className="full-header">
            <DialogClose className="back-button">
              <ArrowLeft size={20} />
              Back to day
            </DialogClose>
            <DialogTitle>
              RouteRunner <span>· {copenhagenTrip.title}</span>
            </DialogTitle>
            <span className="full-deadline">
              Hard stop <b>{day.hardEndTime}</b>
            </span>
          </div>
          <DialogDescription className="sr-only">
            Full static route map. Closing returns to the unchanged execution
            state.
          </DialogDescription>
          <div className="full-map-body">
            <RouteMap
              stops={mapStops}
              trip={mapState}
              onStop={setDetail}
              full
              showCurrentPosition={false}
            />
          </div>
          <div className="full-bottom">
            <div>
              <p className="eyebrow">
                {current ? 'NOW' : started ? 'NO CURRENT' : 'FIRST STOP'}
              </p>
              <strong>{displayedStop?.name ?? 'No Current remains'}</strong>
              {nextStop && (
                <span>
                  <ArrowRight size={15} />
                  {nextStop.name}
                </span>
              )}
            </div>
            <DialogClose className="primary">
              Back to day
              <ArrowRight size={18} />
            </DialogClose>
          </div>
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
          {detail !== null && (
            <>
              <div className="sheet-top">
                <span className="eyebrow">
                  STOP {detail + 1} OF {copenhagenTrip.stops.length} ·{' '}
                  {presentationStatus(
                    copenhagenTrip.stops[detail].id,
                  ).toUpperCase()}
                </span>
                <SheetClose
                  className="sheet-close"
                  aria-label="Close stop details"
                >
                  <X size={22} />
                </SheetClose>
              </div>
              <SheetTitle className="detail-title">
                {copenhagenTrip.stops[detail].name}
              </SheetTitle>
              <SheetDescription className="detail-description">
                {copenhagenTrip.stops[detail].plannedVisitMinutes} min to
                explore
                {' · '}
                {priorityLabel(copenhagenTrip.stops[detail])}
              </SheetDescription>
              {copenhagenTrip.stops[detail].id ===
                copenhagenStopIds.kastellet && (
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
              {started && detail === currentIndex && nextStop && (
                <div className="detail-next">
                  <ArrowRight size={20} />
                  <div>
                    <span>After this</span>
                    <strong>{nextStop.name}</strong>
                  </div>
                </div>
              )}
              <div className="actions">
                {!started && detail === 0 && (
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
                {started && detail === currentIndex && current && (
                  <button className="primary" onClick={done}>
                    <Check size={20} /> Done
                  </button>
                )}
                {(detail !== currentIndex || !started) && (
                  <SheetClose className="primary">Back to day</SheetClose>
                )}
              </div>
              {started && detail === currentIndex && current && (
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
