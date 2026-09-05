'use client';
import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Expand,
  Footprints,
  Route,
  Ship,
  TrainFront,
  Plane,
  Flag,
  MapPin,
  X,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import RouteMap from './route-map';
import {
  stops,
  normal,
  scenario,
  time,
  nextIndex,
  leg,
  remaining,
  advance,
  skipReffen,
  stopStatus,
} from './trip';
const scenarios = [
  ['A', 'A · Trip start'],
  ['B', 'B · Normal execution'],
  ['C', 'C · Schedule tight'],
  ['F', 'F · Reffen skipped · back on plan'],
  ['D', 'D · Fullscreen map'],
  ['E', 'E · Stop expanded'],
  ['risk', 'Deadline at risk'],
  ['complete', 'Trip completed'],
];
function Mode({ mode, size = 16 }: { mode: string; size?: number }) {
  return mode === 'ferry' ? (
    <Ship size={size} />
  ) : mode === 'transit' ? (
    <TrainFront size={size} />
  ) : (
    <Footprints size={size} />
  );
}
export default function Page() {
  const [trip, setTrip] = useState(normal);
  const [demo, setDemo] = useState('B');
  const [full, setFull] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const [kept, setKept] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [skipNotice, setSkipNotice] = useState<'brief' | 'on-plan' | ''>('');
  const finished = trip.current >= 7 || trip.ended;
  const current = stops[Math.min(trip.current, 6)];
  const next = nextIndex(trip);
  const upcoming = next < 7 ? stops[next] : null;
  const nextLeg = next < 7 ? leg(next, trip) : null;
  const buffer = trip.skipped ? 35 : 1110 - trip.clock - remaining(trip);
  const tight = buffer <= 20 && !finished;
  const risk = buffer < 0 && !finished;
  const endTime = 1110 - buffer;
  const canSkip = !trip.skipped && trip.current <= 5 && !finished;
  function preview(key: string) {
    setDemo(key);
    setFeedback('');
    setSkipNotice('');
    if (key === 'D') {
      setFull(true);
      return;
    }
    if (key === 'E') {
      setDetail(Math.min(trip.current, 6));
      return;
    }
    setTrip(scenario(key));
    setKept(false);
    setFull(false);
    setDetail(null);
  }
  function done() {
    setTrip((t) => advance(t));
    setFeedback(
      trip.started
        ? `${current.name} completed. ${upcoming ? `${upcoming.name} is now your current stop.` : 'Your sightseeing is complete.'}`
        : 'Your day starts at Nyhavn.',
    );
  }
  function skip() {
    setTrip((t) => skipReffen(t));
    setDemo('F');
    setSkipNotice('brief');
    setFeedback('Reffen skipped · +17 min buffer');
    window.setTimeout(() => {
      setSkipNotice('on-plan');
      setFeedback('Back on plan · 35 min buffer');
    }, 1500);
    setDetail(null);
  }
  function navHref(index: number) {
    const s = stops[index];
    return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=${s.mode === 'walk' ? 'walking' : 'transit'}`;
  }
  function navigation(index: number) {
    return (
      <a
        className="secondary"
        href={navHref(index)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          setFeedback(
            `Directions to ${stops[index].name} opened in Google Maps. Your place in RouteRunner is saved in this tab.`,
          )
        }
      >
        <ArrowUpRight size={21} />
        Navigate
      </a>
    );
  }
  const completed = stops.filter(
    (_, i) => stopStatus(i, trip) === 'completed',
  ).length;
  return (
    <>
      <main className="prototype">
        <div className="prototype-bar">
          <span>
            INTERACTIVE PROTOTYPE <b>v0</b>
          </span>
          <Select value={demo} onValueChange={(v) => v && preview(v)}>
            <SelectTrigger
              className="scenario-select"
              aria-label="Preview design state"
            >
              <SelectValue>
                {scenarios.find((x) => x[0] === demo)?.[1]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {scenarios.map(([value, label]) => (
                <SelectItem
                  key={value}
                  value={value}
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
            Copenhagen
          </div>
        </header>
        <section className="trip-heading">
          <div>
            <p className="eyebrow">
              ONE DAY · {trip.skipped ? '6' : '7'} STOPS
            </p>
            <h1>
              Copenhagen<span className="heading-dot">.</span>
            </h1>
          </div>
          <div className={`schedule ${tight ? 'tight' : ''}`}>
            <strong>
              <i />
              {finished
                ? 'Day complete'
                : !trip.started
                  ? 'Ready when you are'
                  : risk
                    ? 'Deadline at risk'
                    : tight
                      ? 'Schedule tight'
                      : 'On plan'}
            </strong>
            <span>
              {finished
                ? `${completed} stops visited`
                : !trip.started
                  ? 'Start at 10:00'
                  : risk
                    ? `${Math.abs(buffer)} min over plan`
                    : `${buffer} min buffer`}
            </span>
          </div>
        </section>
        <div className="workspace">
          <div className="map-column">
            <section className="map-panel">
              <RouteMap trip={trip} onStop={setDetail} />
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
                  {finished ? 'ALL SET' : trip.started ? 'NOW' : 'FIRST STOP'}
                </span>
                <span className="current-time">
                  <Clock size={14} />
                  {time(trip.clock)} <small>demo</small>
                </span>
              </div>
              {finished ? (
                <div className="finished">
                  <div className="finish-check">
                    <Check size={28} />
                  </div>
                  <h2>
                    {trip.ended
                      ? 'Time to head out.'
                      : 'A good day, well spent.'}
                  </h2>
                  <p>
                    {trip.ended
                      ? 'Sightseeing has ended. Your unvisited stops stay in today’s itinerary.'
                      : `${completed} stops visited${trip.skipped ? ' · Reffen skipped' : ''}. You’re ready for the next part of your journey.`}
                  </p>
                  <div className="airport-callout">
                    <Plane size={22} />
                    <div>
                      <strong>Next, Copenhagen Airport</strong>
                      <span>Metro M2 · follow live directions</span>
                    </div>
                  </div>
                  <a
                    className="primary"
                    href="https://www.google.com/maps/dir/?api=1&destination=Copenhagen+Airport&travelmode=transit"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Airport directions
                    <ArrowUpRight size={18} />
                  </a>
                </div>
              ) : (
                <>
                  <button
                    className="now stop-open"
                    onClick={() => setDetail(trip.current)}
                  >
                    <span className="big-number">{trip.current + 1}</span>
                    <div>
                      <h2>{current.name}</h2>
                      <p>
                        {trip.started ? 'Explore' : 'Your day begins here'} · ~
                        {current.minutes + trip.extra} min
                      </p>
                    </div>
                    <ChevronRight size={22} />
                  </button>
                  {!trip.started && (
                    <p className="start-intro">
                      A waterfront morning, a walk through the city, and a
                      little room to wander.
                    </p>
                  )}
                  {upcoming && (
                    <button
                      className="next-step stop-open"
                      onClick={() => setDetail(next)}
                    >
                      <span className="next-arrow">
                        <ArrowRight size={21} />
                      </span>
                      <div>
                        <p className="eyebrow">
                          NEXT{' '}
                          {upcoming.kind === 'optional' && (
                            <span className="inline-optional">◇ OPTIONAL</span>
                          )}
                        </p>
                        <h3>{upcoming.name}</h3>
                        <p>
                          <Mode mode={nextLeg!.mode} />
                          {nextLeg!.label} · {nextLeg!.minutes} min
                          {nextLeg!.distance && ` · ${nextLeg!.distance}`}
                        </p>
                      </div>
                      <ChevronRight size={19} />
                    </button>
                  )}
                  {!upcoming && (
                    <div className="next-step last-stop">
                      <Plane size={22} />
                      <div>
                        <p className="eyebrow">AFTER SIGHTSEEING</p>
                        <h3>Copenhagen Airport</h3>
                        <p>Metro M2 · onward journey</p>
                      </div>
                    </div>
                  )}
                  <div className="actions">
                    {navigation(trip.started && next < 7 ? next : trip.current)}
                    <button className="primary" onClick={done}>
                      {trip.started ? (
                        <Check size={21} />
                      ) : (
                        <ArrowRight size={21} />
                      )}{' '}
                      {trip.started ? 'Done' : 'Start day'}
                    </button>
                  </div>
                  <p className="action-context">
                    {trip.started
                      ? `Done completes ${current.name}.`
                      : 'Your prepared route is ready.'}
                  </p>
                </>
              )}
              <div className="deadline">
                <span>
                  <Flag size={15} />
                  Hard stop <strong>18:30</strong>
                </span>
                <span>
                  {finished ? 'Then, airport' : `Est. finish ${time(endTime)}`}
                </span>
              </div>
            </section>
            {tight && canSkip && !kept && (
              <section
                className="recommendation"
                aria-label="Optional stop recommendation"
              >
                <div className="recommendation-title">
                  <span className="optional-diamond">◇</span>
                  <strong>A little more breathing room</strong>
                </div>
                <p>
                  Reffen adds about 40 min. Only {buffer} min of buffer remain
                  before the 18:30 hard stop.
                </p>
                <div className="recommendation-actions">
                  <button onClick={skip}>
                    Skip Reffen <ArrowRight size={17} />
                  </button>
                  <button onClick={() => setKept(true)}>Keep it</button>
                </div>
                <span>Skip Reffen → restore ~35 min buffer.</span>
              </section>
            )}
            {risk && (
              <div className="risk-note">
                <Clock size={19} />
                <div>
                  <strong>Sightseeing ends at 18:30</strong>
                  <p>
                    Shorten your remaining visits to protect your airport
                    journey.
                  </p>
                  <button
                    onClick={() => {
                      setTrip((t) => ({ ...t, ended: true }));
                      setFeedback(
                        'Sightseeing ended. Continue to the airport.',
                      );
                    }}
                  >
                    End sightseeing now <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}
            <div
              className={`feedback ${feedback ? 'has-feedback' : ''} ${skipNotice ? `skip-${skipNotice}` : ''}`}
              role="status"
              aria-live="polite"
            >
              {feedback}
            </div>
            <section className="itinerary" aria-label="Full day itinerary">
              <div className="section-heading">
                <h2>Your day</h2>
                <span>
                  {completed} of {trip.skipped ? 6 : 7} visited
                </span>
              </div>
              <ol>
                {stops.map((s, i) => {
                  const status = stopStatus(i, trip);
                  const travel = leg(i, trip);
                  return (
                    <li key={s.name} className={`itinerary-item ${status}`}>
                      {i > 0 && status !== 'skipped' && (
                        <div className="transit-row">
                          <Mode mode={travel.mode} size={14} />
                          <span>
                            {travel.label} · {travel.minutes} min
                            {travel.distance && ` · ${travel.distance}`}
                          </span>
                        </div>
                      )}
                      <button
                        className="itinerary-stop"
                        onClick={() => setDetail(i)}
                        aria-label={`${s.name}, ${status}, ${s.kind}`}
                      >
                        <span
                          className={`stop-number ${s.kind === 'optional' ? 'optional-number' : ''}`}
                        >
                          {status === 'completed' ? (
                            <Check size={17} />
                          ) : status === 'skipped' ? (
                            '−'
                          ) : (
                            i + 1
                          )}
                        </span>
                        <div>
                          <strong>{s.name}</strong>
                          <span>
                            {status === 'skipped'
                              ? 'Skipped · optional'
                              : status === 'completed'
                                ? 'Visited'
                                : `${s.minutes} min${s.kind === 'must' ? ' · Must-see' : s.kind === 'optional' ? ' · Optional' : ''}`}
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
                  <strong>18:30 · Sightseeing ends</strong>
                  <span>Airport after sightseeing · Metro M2</span>
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
            Design prototype · illustrative timings and transit legs, not live
            travel guidance.
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
              RouteRunner <span>· Copenhagen</span>
            </DialogTitle>
            <span className="full-deadline">
              Hard stop <b>18:30</b>
            </span>
          </div>
          <DialogDescription className="sr-only">
            Full route map. Closing returns to your unchanged trip state.
          </DialogDescription>
          <div className="full-map-body">
            <RouteMap trip={trip} onStop={setDetail} full />
          </div>
          <div className="full-bottom">
            <div>
              <p className="eyebrow">
                {finished
                  ? 'DAY COMPLETE'
                  : trip.started
                    ? 'NOW'
                    : 'FIRST STOP'}
              </p>
              <strong>{finished ? 'On to the airport' : current.name}</strong>
              {!finished && upcoming && (
                <span>
                  <ArrowRight size={15} />
                  {upcoming.name} · {nextLeg!.minutes} min
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
                  STOP {detail + 1} OF 7 ·{' '}
                  {stopStatus(detail, trip).toUpperCase()}
                </span>
                <SheetClose
                  className="sheet-close"
                  aria-label="Close stop details"
                >
                  <X size={22} />
                </SheetClose>
              </div>
              <SheetTitle className="detail-title">
                {stops[detail].name}
              </SheetTitle>
              <SheetDescription className="detail-description">
                {stops[detail].minutes} min to explore ·{' '}
                {stops[detail].kind === 'optional'
                  ? 'Optional stop'
                  : stops[detail].kind === 'must'
                    ? 'Must-see'
                    : 'Part of your route'}
              </SheetDescription>
              {detail === 3 && (
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
              <p className="stop-note">{stops[detail].note}</p>
              {detail < 6 && (
                <div className="detail-next">
                  <ArrowRight size={20} />
                  <div>
                    <span>After this</span>
                    <strong>
                      {
                        stops[detail === 4 && trip.skipped ? 6 : detail + 1]
                          .name
                      }
                    </strong>
                  </div>
                </div>
              )}
              <div className="actions">
                {navigation(detail)}
                {detail === trip.current && !finished && (
                  <button
                    className="primary"
                    onClick={() => {
                      done();
                      setDetail(null);
                    }}
                  >
                    {trip.started ? (
                      <Check size={20} />
                    ) : (
                      <ArrowRight size={20} />
                    )}{' '}
                    {trip.started ? 'Done' : 'Start day'}
                  </button>
                )}
                {detail !== trip.current && (
                  <SheetClose className="primary">Back to day</SheetClose>
                )}
              </div>
              {detail === 5 && canSkip && (
                <button className="skip-detail" onClick={skip}>
                  Skip this optional stop
                </button>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
