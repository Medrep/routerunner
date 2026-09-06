'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Flag,
  Footprints,
  MapPin,
  Route,
  Ship,
  TrainFront,
} from 'lucide-react';
import RouteMap from '../route-map';
import { normal, type Trip } from '../trip';

type StateKind =
  | 'execution'
  | 'sheet'
  | 'decision'
  | 'resolution'
  | 'preview'
  | 'overview'
  | 'complete'
  | 'zero';

type BoardState = {
  id: string;
  title: string;
  city: 'Copenhagen' | 'Rome';
  day: string;
  kind: StateKind;
  health?: string;
  metric?: string;
  firstStop?: string;
  firstStopMeta?: string;
  current?: string;
  next?: string;
  currentMeta?: string;
  nextMeta?: string;
  description: string;
  actions: string[];
  itinerary: Array<{
    name: string;
    status: string;
    meta?: string;
    number?: number;
    selected?: boolean;
  }>;
  selectedStop?: string;
  selectedMeta?: string;
  mapTrip?: Trip;
  note?: string;
  hardStop?: string;
  timedAlert?: string;
  fullMap?: boolean;
};

const cphNames = [
  'Nyhavn',
  'Amalienborg',
  'Marble Church',
  'Kastellet',
  'Little Mermaid',
  'Reffen',
  'Christiania',
];

function cphPlan(
  current: number | null,
  options: {
    skipped?: number[];
    saved?: number[];
    selected?: number;
    completedThrough?: number;
  } = {},
) {
  const skipped = options.skipped ?? [];
  const saved = options.saved ?? [];
  return cphNames.map((name, index) => {
    let status = 'future';
    if (skipped.includes(index)) status = 'skipped';
    else if (saved.includes(index)) status = 'saved';
    else if (current !== null && index < current) status = 'completed';
    else if (current !== null && index === current) status = 'current';
    else if (current !== null && index === current + 1) status = 'next';
    else if (current === null && index <= (options.completedThrough ?? -1))
      status = 'completed';
    else if (index === 5) status = 'optional';
    const meta =
      status === 'completed'
        ? 'Visited'
        : status === 'current'
          ? `NOW · ${index === 4 ? '15 min' : index === 6 ? '35 min' : '20 min'}`
          : status === 'next'
            ? `NEXT · ${index === 5 ? 'Harbour Bus 992 · 18 min' : 'Walk · 14 min'}`
            : status === 'optional'
              ? 'OPTIONAL · 35 min'
              : status === 'skipped'
                ? 'Skipped · optional'
                : status === 'saved'
                  ? 'Saved for later'
                  : `${index === 6 ? 'MUST · 35 min' : 'Planned stop'}`;
    return {
      name,
      number: index + 1,
      status,
      meta,
      selected: options.selected === index,
    };
  });
}

const cphTrip = (current: number, options: Partial<Trip> = {}): Trip => ({
  current,
  clock: current === 0 ? 600 : current === 4 ? 955 : 912,
  started: true,
  skipped: false,
  saved: [],
  extra: 0,
  ended: false,
  ...options,
});

const cphItinerary = cphPlan(3);

const cphSkipped = cphPlan(7, { skipped: [5] });

const romeItinerary = [
  { name: 'Colosseum', number: 1, status: 'current', meta: 'NOW · 60 min' },
  { name: 'Roman Forum', number: 2, status: 'next', meta: 'NEXT · Walk 8 min' },
  { name: 'Pantheon', number: 3, status: 'future', meta: 'MUST · 35 min' },
  {
    name: 'Trevi Fountain',
    number: 4,
    status: 'future',
    meta: 'MUST · 25 min',
  },
  {
    name: 'Trastevere',
    number: 5,
    status: 'optional',
    meta: 'OPTIONAL · 45 min',
  },
];

const states: BoardState[] = [
  {
    id: 'cph-ready',
    title: 'Copenhagen · Ready / Start Day',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'Ready when you are',
    metric: 'Start at 10:00',
    firstStop: 'Nyhavn',
    firstStopMeta: 'Waterfront · 30 min',
    description:
      'No Current exists before Start day. Starting is an explicit action.',
    actions: ['Start day', 'Start & navigate'],
    itinerary: cphPlan(null).map((stop, index) => ({
      ...stop,
      status: index === 0 ? 'ready' : stop.status,
      meta: index === 0 ? 'FIRST STOP · 30 min' : stop.meta,
    })),
    mapTrip: cphTrip(0, { started: false }),
    hardStop: 'Hard stop · 18:30',
  },
  {
    id: 'cph-normal',
    title: 'Copenhagen · Normal execution',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Explore · 20 min',
    nextMeta: 'NEXT · Walk 14 min · 1.1 km',
    description:
      'The execution shell answers where, what now, what next, and what remains.',
    actions: ['Navigate', 'Done'],
    itinerary: cphItinerary,
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30 · Est. finish 17:48',
  },
  {
    id: 'cph-current-next',
    title: 'Copenhagen · Current + Next + full itinerary',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Explore · 20 min',
    nextMeta: 'NEXT · Walk 14 min · 1.1 km',
    description:
      'Canonical mobile reference: the remaining plan stays below Current / Next in the same scroll.',
    actions: ['Navigate', 'Done'],
    itinerary: cphItinerary,
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30 · Est. finish 17:48',
    note: 'Completed, current, next, future, optional and MUST are visible together.',
  },
  {
    id: 'cph-current-details',
    title: 'Copenhagen · Current stop details',
    city: 'Copenhagen',
    day: 'Day 1 · Kastellet',
    kind: 'sheet',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'CURRENT · Expected stop · 20 min',
    nextMeta: 'After this · Little Mermaid',
    description:
      'Bottom sheet for Current. Navigate and Done are available only for the expected stop.',
    actions: ['Navigate', 'Done', 'Skip', 'Save for later'],
    itinerary: cphPlan(3, { selected: 3 }),
    selectedStop: 'Kastellet',
    selectedMeta: 'CURRENT · Expected stop · 20 min',
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30',
  },
  {
    id: 'cph-full-map',
    title: 'Copenhagen · Full Map',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Explore · 20 min',
    nextMeta: 'NEXT · Walk 14 min · 1.1 km',
    description:
      'Expanded map preserves the same Current, Next, GPS and route context. Back to day returns to the unchanged execution state.',
    actions: ['Back to day'],
    itinerary: cphItinerary,
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30 · Est. finish 17:48',
    fullMap: true,
    note: 'GPS and Current remain distinct; completed, future, optional and MUST stops stay legible on the route.',
  },
  {
    id: 'cph-future-details',
    title: 'Copenhagen · Future stop details',
    city: 'Copenhagen',
    day: 'Day 1 · Little Mermaid',
    kind: 'sheet',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Kastellet · 20 min',
    nextMeta: 'SELECTED · Future stop',
    description:
      'Future stops use bounded actions. Ordinary Navigate and Done do not appear here.',
    actions: ['Do now', 'Already visited', 'Skip', 'Save for later'],
    itinerary: cphPlan(3, { selected: 4 }),
    selectedStop: 'Little Mermaid',
    selectedMeta: 'FUTURE STOP · #5',
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30',
    note: 'Already visited records early completion and preserves the route history.',
  },
  {
    id: 'cph-tight',
    title: 'Copenhagen · Schedule tight',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'decision',
    health: 'Schedule tight',
    metric: '18 min buffer',
    current: 'Little Mermaid',
    next: 'Reffen',
    currentMeta: 'NOW · Explore · 15 min',
    nextMeta: 'NEXT · Harbour Bus 992 · 18 min',
    description:
      'The optional decision is explicit and bounded by the 18:30 hard stop.',
    actions: ['Skip Reffen', 'Keep it'],
    itinerary: cphPlan(4),
    mapTrip: cphTrip(4, { extra: 15 }),
    hardStop: 'Hard stop · 18:30 · Est. finish 18:12',
    note: 'Reffen adds about 40 min. Only 18 min of buffer remain before the 18:30 hard stop. Skip Reffen → restore ~35 min buffer.',
  },
  {
    id: 'cph-keep',
    title: 'Copenhagen · Keep Reffen acknowledgement',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'decision',
    health: 'Schedule tight',
    metric: '18 min buffer',
    current: 'Little Mermaid',
    next: 'Reffen',
    currentMeta: 'NOW · Explore · 15 min',
    nextMeta: 'NEXT · Harbour Bus 992 · 18 min',
    description:
      'Keep it is a persistent acknowledgement. The recommendation is dismissed and may reappear only at higher risk.',
    actions: ['Keep it acknowledged', 'Back to current'],
    itinerary: cphPlan(4),
    mapTrip: cphTrip(4, { extra: 15 }),
    hardStop: 'Hard stop · 18:30',
    note: 'You chose to keep Reffen. RouteRunner keeps the decision visible in the schedule context.',
  },
  {
    id: 'cph-risk',
    title: 'Copenhagen · Deadline at risk',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'Deadline at risk',
    metric: '18 min over plan',
    current: 'Little Mermaid',
    next: 'Reffen',
    currentMeta: 'NOW · 15 min remaining',
    nextMeta: 'NEXT · Optional stop',
    description:
      'At negative buffer, the app reports neutral risk information. Nothing is auto-skipped or newly prescribed.',
    actions: ['Navigate', 'Done', 'End sightseeing now'],
    itinerary: cphPlan(4),
    mapTrip: cphTrip(4, { clock: 1005, extra: 15 }),
    note: 'Projected finish is 18 min beyond the prepared 18:30 hard stop.',
    hardStop: 'Hard stop · 18:30 · Est. finish 18:48',
  },
  {
    id: 'cph-unavailable',
    title: 'Copenhagen · Schedule unavailable',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'Schedule estimate temporarily unavailable',
    metric: 'Estimate unavailable',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Explore · 20 min',
    nextMeta: 'NEXT · Travel time unknown',
    description:
      'No false precision: controls stay available while timing estimates are temporarily unavailable.',
    actions: ['Navigate', 'Done'],
    itinerary: cphItinerary,
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30 · Travel estimate unavailable',
    note: 'Travel time unknown. RouteRunner will restore schedule context when an estimate is available.',
  },
  {
    id: 'cph-routing-loading',
    title: 'Copenhagen · Map / routing degraded',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'Schedule estimate temporarily unavailable',
    metric: 'Estimate unavailable',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Explore · 20 min',
    nextMeta: 'NEXT · Travel time unknown',
    description:
      'A loading / degradation presentation keeps the route usable without inventing ETA, buffer, or recovery minutes.',
    actions: ['Navigate', 'Done'],
    itinerary: cphItinerary,
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30 · Estimate unavailable',
    note: 'Loading route estimate… Travel time unknown. Current actions remain available.',
  },
  {
    id: 'cph-timed-alert',
    title: 'Copenhagen · Timed-stop alert + ON PLAN',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Kastellet',
    next: 'Little Mermaid',
    currentMeta: 'NOW · Explore · 20 min',
    nextMeta: 'NEXT · Walk 14 min · 1.1 km',
    description:
      'A timed-stop alert is separate from overall schedule health; both facts remain visible together.',
    actions: ['Navigate', 'Done'],
    itinerary: cphItinerary,
    mapTrip: cphTrip(3),
    hardStop: 'Hard stop · 18:30 · Est. finish 17:48',
    timedAlert: 'Reffen arrival · Projected 12 min late',
  },
  {
    id: 'cph-hard-stop',
    title: 'Copenhagen · Hard stop reached / End Day',
    city: 'Copenhagen',
    day: 'Day 1 · 18:30',
    kind: 'resolution',
    health: 'Hard stop reached',
    metric: 'End sightseeing',
    current: 'Christiania',
    currentMeta: 'CURRENT · End of sightseeing window',
    description:
      'The hard deadline is a clear decision point. It never auto-completes or silently skips stops.',
    actions: ['End sightseeing', 'Keep going'],
    itinerary: cphPlan(6),
    mapTrip: cphTrip(6, { clock: 1110 }),
    hardStop: 'Hard stop reached · 18:30',
  },
  {
    id: 'cph-leftovers',
    title: 'Copenhagen · End Day leftovers resolution',
    city: 'Copenhagen',
    day: 'Day 1 · End day',
    kind: 'resolution',
    health: 'End day',
    metric: '2 stops remain',
    current: undefined,
    currentMeta: 'Resolve leftovers before ending',
    description:
      'Ending the day surfaces an explicit bounded resolution for remaining work.',
    actions: ['Save all for later', 'Review individually', 'Cancel'],
    itinerary: cphPlan(null, { completedThrough: 3 }).map((stop, index) =>
      index > 3 ? { ...stop, meta: 'Remaining' } : stop,
    ),
    mapTrip: cphTrip(4, { ended: true }),
    hardStop: 'Hard stop · 18:30',
    note: '2 stops remain from Day 1. Choose how to resolve them before the day ends.',
  },
  {
    id: 'cph-complete',
    title: 'Copenhagen · Trip Complete + Airport',
    city: 'Copenhagen',
    day: 'Day 1 · Complete',
    kind: 'complete',
    health: 'Trip complete',
    metric: 'Sightseeing complete',
    current: 'A good day, well spent.',
    currentMeta: 'All active stops resolved',
    description:
      'Airport is a post-trip destination, distinct from ordinary sightseeing Next.',
    actions: ['Airport directions'],
    itinerary: cphSkipped.map((stop) => ({
      ...stop,
      status: stop.status === 'skipped' ? 'skipped' : 'completed',
      meta: stop.status === 'skipped' ? stop.meta : 'Visited',
    })),
    mapTrip: cphTrip(7, { skipped: true }),
    hardStop: 'Sightseeing ended · Airport after sightseeing',
  },
  {
    id: 'for-later',
    title: 'Copenhagen · For Later section',
    city: 'Copenhagen',
    day: 'Trip level · For later',
    kind: 'zero',
    health: 'For later',
    metric: '1 saved stop',
    current: 'No Current',
    currentMeta: 'Saved stops sit outside the active route',
    description:
      'Saved for later is separate from the active route and excluded from ETA / buffer.',
    actions: ['Do now', 'Already visited'],
    itinerary: [
      {
        name: 'Reffen',
        number: 6,
        status: 'saved',
        meta: 'Saved for later · Optional',
      },
    ],
    note: 'For Later points are neutral on the map and do not block completion.',
  },
  {
    id: 'save-current',
    title: 'Copenhagen · Save Current for Later result',
    city: 'Copenhagen',
    day: 'Day 1 · One day',
    kind: 'execution',
    health: 'On plan',
    metric: '42 min buffer',
    current: 'Little Mermaid',
    next: 'Reffen',
    currentMeta: 'NOW · Next stop promoted immediately',
    nextMeta: 'NEXT · Harbour Bus 992 · 18 min',
    description:
      'Saving Current removes it from the active route without implying that it was reached.',
    actions: ['Navigate', 'Done'],
    itinerary: cphPlan(4, { saved: [3] }),
    mapTrip: cphTrip(4, { saved: [3] }),
    note: 'Kastellet saved for later · Little Mermaid is now Current.',
    hardStop: 'Hard stop · 18:30',
  },
  {
    id: 'rome-overview',
    title: 'Rome · Trip overview',
    city: 'Rome',
    day: '2 days · Day 1 active',
    kind: 'overview',
    metric: '2 days',
    description:
      'Rome uses the same execution shell across a multi-day trip, with an explicit active day.',
    actions: ['Open Day 1', 'Preview Day 2'],
    itinerary: [
      { name: 'Day 1', status: 'current', meta: 'ACTIVE · 5 stops' },
      { name: 'Day 2', status: 'future', meta: 'PREPARED · 3 stops' },
    ],
    note: 'Trip overview opens a prepared day without editing the plan.',
  },
  {
    id: 'rome-preview',
    title: 'Rome · Day 2 preview while Day 1 executes',
    city: 'Rome',
    day: 'Day 2 · Preview',
    kind: 'preview',
    metric: 'Preview · not executing',
    current: 'Colosseum',
    next: 'Vatican Museums',
    nextMeta: 'NEXT ON DAY 2 · Metro 18 min',
    description:
      'A viewed day is clearly a preview. Day 1 remains the active execution day.',
    actions: ['Return to active Day 1'],
    itinerary: [
      {
        name: 'Vatican Museums',
        number: 1,
        status: 'future',
        meta: 'MUST · 2h',
      },
      {
        name: 'Piazza Navona',
        number: 2,
        status: 'future',
        meta: 'MUST · 30 min',
      },
      {
        name: 'Villa Borghese',
        number: 3,
        status: 'optional',
        meta: 'OPTIONAL · 45 min',
      },
    ],
    note: 'Day 2 preview · Day 1 still executing in the background of this prototype.',
  },
  {
    id: 'rome-queue',
    title: 'Rome · Do Now selected / queued',
    city: 'Rome',
    day: 'Day 1 · One day',
    kind: 'sheet',
    metric: 'Estimated finish · 17:20',
    current: 'Colosseum',
    next: 'Pantheon',
    currentMeta: 'NOW · Explore · 60 min',
    nextMeta: 'QUEUED FOR NOW · after Current',
    description:
      'Do now queues a future stop after Current in FIFO order. Duplicate Do now is unavailable.',
    actions: ['Cancel Do Now'],
    itinerary: [
      { name: 'Colosseum', number: 1, status: 'current', meta: 'NOW · 60 min' },
      {
        name: 'Pantheon',
        number: 3,
        status: 'queued',
        meta: 'QUEUED FOR NOW · NEXT',
      },
      {
        name: 'Roman Forum',
        number: 2,
        status: 'future',
        meta: 'Returns after queued stop',
      },
      { name: 'Trevi Fountain', number: 4, status: 'future', meta: 'Future' },
    ],
    selectedStop: 'Pantheon',
    selectedMeta: 'Queued for now',
    note: 'Queued for now · Pantheon will follow Colosseum. It is not Current.',
  },
  {
    id: 'rome-visited',
    title: 'Rome · Already Visited future stop',
    city: 'Rome',
    day: 'Day 1 · Pantheon',
    kind: 'sheet',
    metric: 'Estimated finish · 17:20',
    current: 'Colosseum',
    next: 'Roman Forum',
    currentMeta: 'NOW · Colosseum · 60 min',
    nextMeta: 'NEXT · Roman Forum · Walk 8 min',
    description:
      'Already visited is available for future / non-current stops only.',
    actions: ['Already visited'],
    itinerary: romeItinerary.map((stop) =>
      stop.name === 'Pantheon'
        ? {
            ...stop,
            status: 'visited-early',
            meta: 'Already visited on Day 1',
            selected: true,
          }
        : stop,
    ),
    selectedStop: 'Pantheon',
    selectedMeta: 'ALREADY VISITED · #3',
    note: 'Pantheon · Already visited on Day 1. The visit remains in trip history.',
  },
  {
    id: 'rome-day1-complete',
    title: 'Rome · Day 1 Complete',
    city: 'Rome',
    day: 'Day 1 · Complete',
    kind: 'complete',
    health: 'Day complete',
    metric: 'Tomorrow · Day 2',
    current: 'Day 1 complete',
    currentMeta: 'All active Day 1 items resolved',
    next: 'Day 2',
    nextMeta: 'Vatican Museums · 09:30',
    description:
      'Non-final days end with a reversible Day Complete moment and a clear next day.',
    actions: ['View tomorrow', 'Start Day 2'],
    itinerary: romeItinerary.map((stop) => ({
      ...stop,
      status: 'completed',
      meta: 'Visited',
    })),
    note: 'For Later items remain available and can be brought back with Do now.',
  },
  {
    id: 'rome-start-day2-leftovers',
    title: 'Rome · Start Day 2 with Day 1 leftovers',
    city: 'Rome',
    day: 'Day 2 · Start day',
    kind: 'resolution',
    metric: '2 stops remain from Day 1',
    current: 'No Current',
    currentMeta: 'Resolve leftovers before Day 2 starts',
    next: 'Vatican Museums',
    nextMeta: 'Day 2 · 09:30',
    description:
      'Leftovers are never auto-skipped or silently transferred into a new day.',
    actions: ['Save all for later', 'Review individually', 'Cancel'],
    itinerary: [
      { name: 'Day 1 leftovers', status: 'resolution', meta: '2 stops remain' },
      { name: 'Vatican Museums', status: 'future', meta: 'Day 2 · 09:30' },
    ],
    note: 'Choose how to resolve the two Day 1 stops, then start Day 2 explicitly.',
  },
  {
    id: 'rome-zero-day2',
    title: 'Rome · Zero-work Day 2',
    city: 'Rome',
    day: 'Day 2 · Nothing scheduled',
    kind: 'zero',
    metric: 'Nothing scheduled remains for today',
    current: 'No Current',
    currentMeta: 'There is no active route for this day',
    description:
      'A zero-work day has its own calm empty state and an explicit End day action.',
    actions: ['Do now from For Later', 'End day'],
    itinerary: [
      {
        name: 'For Later',
        status: 'saved',
        meta: '1 saved stop · Do now',
      },
    ],
    note: 'No Current is shown. Saved stops can be reintroduced with Do now.',
  },
  {
    id: 'rome-zero-final',
    title: 'Rome · Zero-work final day with For Later',
    city: 'Rome',
    day: 'Day 2 · Final day',
    kind: 'zero',
    metric: 'Nothing scheduled remains for today',
    current: 'No Current',
    currentMeta: 'Explicit End day completes the trip',
    description:
      'Final-day zero work does not show Trip Complete on entry. The user must end the day.',
    actions: ['Do now from For Later', 'End day'],
    itinerary: [
      {
        name: 'Villa Borghese',
        number: 3,
        status: 'saved',
        meta: 'Saved for later · 1 stop',
      },
    ],
    note: 'For Later is available, but it does not block completion.',
  },
  {
    id: 'rome-neutral',
    title: 'Rome · No-hard-deadline schedule',
    city: 'Rome',
    day: 'Day 1 · One day',
    kind: 'execution',
    metric: 'About 4h 15m remaining',
    current: 'Colosseum',
    next: 'Roman Forum',
    currentMeta: 'NOW · Explore · 60 min',
    nextMeta: 'NEXT · Walk 8 min',
    description:
      'Rome has no hard stop, so it uses neutral remaining-time language instead of health / buffer.',
    actions: ['Navigate', 'Done'],
    itinerary: romeItinerary,
    note: 'Estimated finish · 17:20',
  },
  {
    id: 'rome-final-complete',
    title: 'Rome · Final Trip Complete with saved leftovers',
    city: 'Rome',
    day: 'Day 2 · Complete',
    kind: 'complete',
    health: 'Trip complete',
    metric: '1 saved for later',
    current: 'Trip complete',
    currentMeta: 'All active stops resolved',
    description:
      'Trip Complete is terminal. Saved-for-Later leftovers remain visible as history without Do now.',
    actions: ['View saved stops'],
    itinerary: [
      { name: 'Vatican Museums', status: 'completed', meta: 'Visited' },
      { name: 'Piazza Navona', status: 'completed', meta: 'Visited' },
      {
        name: 'Villa Borghese',
        status: 'saved',
        meta: 'Saved for later · Not visited',
      },
    ],
    note: 'Not visited / Saved for later is shown separately. The trip is complete.',
  },
];

function Mode({ mode }: { mode: 'walk' | 'transit' | 'ferry' }) {
  return mode === 'ferry' ? (
    <Ship size={14} />
  ) : mode === 'transit' ? (
    <TrainFront size={14} />
  ) : (
    <Footprints size={14} />
  );
}

function BoardMap({
  state,
  onStop,
}: {
  state: BoardState;
  onStop: () => void;
}) {
  if (state.id === 'for-later') {
    return (
      <div
        className="board-map board-map-neutral"
        aria-label="Neutral map point for a saved stop"
      >
        <div className="board-map-topline">
          <span>
            <i /> For later
          </span>
          <span>↑ N</span>
        </div>
        <div className="neutral-water" />
        <div className="neutral-grid" />
        <button
          className="neutral-pin"
          onClick={onStop}
          aria-label="Reffen, saved for later"
        >
          ◇
        </button>
        <span className="board-map-caption">Outside active route</span>
      </div>
    );
  }
  if (state.city === 'Copenhagen') {
    const trip: Trip = state.mapTrip ?? normal();
    return <RouteMap trip={trip} onStop={onStop} full={state.fullMap} />;
  }
  const pins = state.itinerary.slice(0, 5);
  return (
    <div
      className="board-map board-map-rome"
      aria-label="Schematic Rome route map"
    >
      <div className="board-map-topline">
        <span>
          <i /> Route overview
        </span>
        <span>↑ N</span>
      </div>
      <div className="rome-water" />
      <div className="rome-grid" />
      <div className="rome-route" />
      {pins.map((pin, index) => (
        <button
          key={pin.name}
          className={`rome-pin ${pin.status}`}
          style={{
            left: `${24 + index * 16}%`,
            top: `${62 - (index % 2) * 21}%`,
          }}
          onClick={onStop}
          aria-label={`${pin.name}, ${pin.status}`}
        >
          {pin.status === 'completed' || pin.status === 'visited-early' ? (
            <Check size={13} />
          ) : (
            (pin.number ?? index + 1)
          )}
        </button>
      ))}
      <span className="board-map-caption">Schematic map · demo location</span>
    </div>
  );
}

function StatusGlyph({ status, number }: { status: string; number?: number }) {
  if (status === 'completed' || status === 'visited-early')
    return <Check size={15} />;
  if (status === 'skipped') return <span>−</span>;
  if (status === 'saved') return <span>◇</span>;
  return <span>{number ?? (status === 'queued' ? '↗' : '○')}</span>;
}

function PreviewButton({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      className={primary ? 'board-button board-button-primary' : 'board-button'}
      onClick={onClick}
    >
      {label}
      {primary && <ArrowRight size={15} />}
    </button>
  );
}

function Itinerary({
  items,
  onStop,
}: {
  items: BoardState['itinerary'];
  onStop: () => void;
}) {
  return (
    <section className="board-itinerary">
      <div className="board-section-heading">
        <h3>Your day</h3>
        <span>{items.length} stops</span>
      </div>
      <ol>
        {items.map((item, index) => (
          <li
            key={`${item.name}-${index}`}
            className={`board-itinerary-item ${item.status}${item.selected ? ' selected' : ''}`}
          >
            <button
              onClick={onStop}
              aria-label={`${item.name}, ${item.status}`}
            >
              <span className="board-stop-number">
                <StatusGlyph status={item.status} number={item.number} />
              </span>
              <span className="board-stop-copy">
                <strong>{item.name}</strong>
                <small>{item.meta ?? item.status}</small>
              </span>
              {item.status === 'current' && <b>NOW</b>}
              {item.status === 'next' && <b className="board-next-tag">NEXT</b>}
              {item.status !== 'current' && item.status !== 'next' && (
                <ChevronRight size={15} />
              )}
            </button>
            {index < items.length - 1 &&
              item.status !== 'skipped' &&
              item.status !== 'saved' && (
                <div className="board-transit">
                  <Mode
                    mode={
                      index % 3 === 1
                        ? 'transit'
                        : index === 3
                          ? 'ferry'
                          : 'walk'
                    }
                  />
                  <span>
                    {index === 3
                      ? 'Harbour Bus 992 · 18 min'
                      : `Walk · ${index + 5} min`}
                  </span>
                </div>
              )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatePreview({
  state,
  feedback,
  onFeedback,
}: {
  state: BoardState;
  feedback: string;
  onFeedback: (value: string) => void;
}) {
  const isCph = state.city === 'Copenhagen';
  const isReady = state.id === 'cph-ready';
  const isPreview = state.kind === 'preview';
  const isOverview = state.kind === 'overview';
  const [sheetOpen, setSheetOpen] = useState(state.kind === 'sheet');
  const [decision, setDecision] = useState<'skip' | 'keep' | ''>('');
  const [resolved, setResolved] = useState(false);
  const isNoCurrent = !state.current || state.current === 'No Current';
  const isFullMap = Boolean(state.fullMap);
  const suppressExecutionProjection =
    state.kind === 'complete' ||
    state.kind === 'zero' ||
    state.id === 'rome-start-day2-leftovers';
  const currentNumber = state.itinerary.find(
    (item) => item.name === (isReady ? state.firstStop : state.current),
  )?.number;
  const displayClock =
    state.id === 'cph-ready'
      ? '10:00'
      : ['cph-tight', 'cph-keep', 'save-current'].includes(state.id)
        ? '15:55'
        : state.id === 'cph-risk'
          ? '16:45'
          : ['cph-hard-stop', 'cph-leftovers'].includes(state.id)
            ? '18:30'
            : state.id === 'cph-complete'
              ? '17:48'
              : isCph
                ? '15:12'
                : '11:05';
  const statusText = state.health ?? 'Preview';
  const action = (label: string) => {
    if (label === 'Skip Reffen') {
      setDecision('skip');
      onFeedback(
        'Reffen skipped · +17 min buffer → Back on plan · 35 min buffer',
      );
      return;
    }
    if (label === 'Keep it') {
      setDecision('keep');
      onFeedback('Keeping Reffen acknowledged · recommendation dismissed');
      return;
    }
    if (label.includes('End')) {
      setResolved(true);
      onFeedback(
        'Day end is explicit. Remaining stops are ready for resolution.',
      );
      return;
    }
    if (label.includes('Do now'))
      onFeedback('Queued for now · this stop follows Current in FIFO order.');
    else if (label.includes('Already'))
      onFeedback('Already visited on Day 1 · recorded in trip history.');
    else if (label.includes('Save'))
      onFeedback('Saved for later · removed from active route and ETA.');
    else if (label.includes('Cancel'))
      onFeedback('Queue cancelled · stop returns to its previous place.');
    else if (label.includes('Start'))
      onFeedback('Day started · Current is now the expected stop.');
    else onFeedback(`${label} selected`);
  };
  const visibleActions =
    state.id === 'cph-tight' && (decision === 'skip' || decision === 'keep')
      ? ['Back to current']
      : state.actions;
  const showDecision = state.id === 'cph-tight' && !decision;
  return (
    <div className="phone-screen">
      <div className="phone-statusbar">
        <span>9:41</span>
        <span>▮▮▮ ᯤ</span>
      </div>
      <header className="phone-brand">
        <div className="phone-brand-mark">
          <Route size={17} />
        </div>
        <strong>RouteRunner</strong>
        <span className="phone-city">
          <MapPin size={12} /> {state.city}
        </span>
      </header>
      <div className="phone-heading">
        <div>
          <p className="board-eyebrow">{state.day.toUpperCase()}</p>
          <h2>
            {state.city}
            <span>.</span>
          </h2>
        </div>
        {state.health ? (
          <div
            className={`phone-health ${state.health.toLowerCase().includes('tight') || state.health.toLowerCase().includes('risk') ? 'warn' : ''}`}
          >
            <strong>
              <i />
              {statusText}
            </strong>
            <small>{state.metric}</small>
          </div>
        ) : (
          <div className="phone-neutral-metric">
            <strong>{state.metric}</strong>
            <small>No hard deadline</small>
          </div>
        )}
      </div>
      {isFullMap && !isOverview && (
        <div className="phone-full-map-header">
          <button onClick={() => action('Back to day')}>
            <ArrowRight size={15} /> Back to day
          </button>
          <strong>Full route map</strong>
          <span>Hard stop · 18:30</span>
        </div>
      )}
      {isOverview ? (
        <section className="phone-trip-overview">
          <p className="board-eyebrow">TRIP OVERVIEW</p>
          <h3>Rome</h3>
          <p className="trip-overview-count">2 days</p>
          <article>
            <div>
              <strong>Day 1</strong>
              <span>Active · 5 stops</span>
            </div>
            <PreviewButton
              label="Open day"
              primary
              onClick={() => action('Open Day 1')}
            />
          </article>
          <article>
            <div>
              <strong>Day 2</strong>
              <span>Prepared · 3 stops</span>
            </div>
            <PreviewButton
              label="Preview"
              onClick={() => action('Preview Day 2')}
            />
          </article>
        </section>
      ) : (
        <BoardMap state={state} onStop={() => setSheetOpen(true)} />
      )}
      {!isOverview && (
        <section
          className={`phone-execution ${isNoCurrent ? 'no-current' : ''}`}
        >
          <div className="phone-execution-top">
            <span className="phone-label">
              {isReady
                ? 'FIRST STOP'
                : isPreview
                  ? 'DAY 2 PREVIEW'
                  : isNoCurrent
                    ? 'NO CURRENT'
                    : state.kind === 'complete'
                      ? 'COMPLETE'
                      : 'NOW'}
            </span>
            <span className="phone-clock">
              <Clock size={13} />
              {displayClock}
            </span>
          </div>
          {isPreview ? (
            <div className="phone-preview-context">
              <strong>Not executing</strong>
              <p>Day 1 remains active · Current: {state.current}</p>
            </div>
          ) : (
            <div className="phone-current-row">
              <span className="phone-big-number">
                {isReady ? (
                  (currentNumber ?? 1)
                ) : isNoCurrent ? (
                  '—'
                ) : state.kind === 'complete' ? (
                  <Check size={22} />
                ) : (
                  (currentNumber ?? '—')
                )}
              </span>
              <div>
                <h3>
                  {isReady ? state.firstStop : (state.current ?? 'No Current')}
                </h3>
                <p>
                  {isReady
                    ? state.firstStopMeta
                    : (state.currentMeta ?? state.description)}
                </p>
              </div>
              {!isNoCurrent && state.kind !== 'complete' && !isReady && (
                <ChevronRight size={18} />
              )}
            </div>
          )}
          {state.next && !isPreview && !isReady && (
            <div className="phone-next-row">
              <span className="phone-next-arrow">
                <ArrowRight size={17} />
              </span>
              <div>
                <p className="board-eyebrow">NEXT</p>
                <h4>{state.next}</h4>
                <p>
                  <Footprints size={13} /> {state.nextMeta}
                </p>
              </div>
              <ChevronRight size={17} />
            </div>
          )}
          {!showDecision && !isFullMap && (
            <div className="phone-actions">
              {visibleActions.slice(0, 2).map((label) => (
                <PreviewButton
                  key={label}
                  label={label}
                  primary={
                    label === 'Done' ||
                    label === 'Start day' ||
                    label === 'Airport directions'
                  }
                  onClick={() => action(label)}
                />
              ))}
            </div>
          )}
          {!showDecision && !isFullMap && visibleActions.length > 2 && (
            <div className="phone-secondary-actions">
              {visibleActions.slice(2).map((label) => (
                <button key={label} onClick={() => action(label)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {showDecision && (
            <div className="phone-decision">
              <strong>◇ A little more breathing room</strong>
              <p>
                Reffen adds about 40 min. Only 18 min of buffer remain before
                the 18:30 hard stop.
              </p>
              <div>
                <PreviewButton
                  label="Skip Reffen"
                  primary
                  onClick={() => action('Skip Reffen')}
                />
                <button onClick={() => action('Keep it')}>Keep it</button>
              </div>
              <small>Skip Reffen → restore ~35 min buffer.</small>
            </div>
          )}
          {state.kind === 'resolution' && (
            <div className={`phone-resolution ${resolved ? 'resolved' : ''}`}>
              <strong>{resolved ? 'Resolution saved' : state.metric}</strong>
              <p>{state.note ?? 'Choose one bounded action to continue.'}</p>
            </div>
          )}
          {state.timedAlert && (
            <div className="phone-timed-alert">
              <Clock size={14} />
              <div>
                <strong>Timed stop</strong>
                <span>{state.timedAlert}</span>
              </div>
            </div>
          )}
          {feedback && <output className="phone-feedback">{feedback}</output>}
          {!suppressExecutionProjection && (
            <div className="phone-deadline">
              {state.hardStop ? (
                <span>
                  <Flag size={13} /> {state.hardStop}
                </span>
              ) : (
                <span>
                  <Clock size={13} /> {state.metric}
                </span>
              )}
              <span>
                {state.city === 'Rome'
                  ? 'Estimated finish · 17:20'
                  : 'Route context'}
              </span>
            </div>
          )}
        </section>
      )}
      {!isOverview && (
        <Itinerary items={state.itinerary} onStop={() => setSheetOpen(true)} />
      )}
      {sheetOpen && state.kind === 'sheet' && (
        <div className="phone-sheet-preview">
          <div className="sheet-handle" />
          <p className="board-eyebrow">
            STOP DETAILS · {state.selectedMeta ?? 'SELECTED STOP'}
          </p>
          <h3>{state.selectedStop ?? state.current ?? state.next}</h3>
          <p>{state.description}</p>
          <div className="sheet-actions">
            {state.actions.slice(0, 2).map((label) => (
              <PreviewButton
                key={label}
                label={label}
                primary={label === 'Done' || label === 'Do now'}
                onClick={() => action(label)}
              />
            ))}
          </div>
          {state.actions.length > 2 && (
            <div className="sheet-secondary-actions">
              {state.actions.slice(2).map((label) => (
                <button key={label} onClick={() => action(label)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <button className="sheet-dismiss" onClick={() => setSheetOpen(false)}>
            Close details
          </button>
        </div>
      )}
      <div className="phone-note">{state.note ?? state.description}</div>
    </div>
  );
}

export default function DesignBoardPage() {
  const [selectedId, setSelectedId] = useState(states[2].id);
  const [feedback, setFeedback] = useState('');
  const state = useMemo(
    () => states.find((item) => item.id === selectedId) ?? states[2],
    [selectedId],
  );
  const grouped = states.reduce<Record<string, BoardState[]>>((acc, item) => {
    const key = item.city;
    acc[key] = [...(acc[key] ?? []), item];
    return acc;
  }, {});
  return (
    <main className="design-board">
      <header className="board-header">
        <div className="board-brand">
          <div className="brand-mark">
            <Route size={22} />
          </div>
          <div>
            <strong>RouteRunner</strong>
            <span>Bounded design update · Astra</span>
          </div>
        </div>
        <div className="board-header-actions">
          <span>iPhone 17 · 1206 × 2622</span>
          <Link href="/">
            Open canonical prototype <ArrowRight size={15} />
          </Link>
        </div>
      </header>
      <section className="board-intro">
        <div>
          <p className="board-kicker">DESIGN REVIEW BOARD · V0.2</p>
          <h1>
            One execution shell.
            <br />
            <span>Every bounded state.</span>
          </h1>
          <p className="board-lede">
            A reviewable reference for Copenhagen and Rome MVP flows. Select a
            state to inspect the mobile behavior without changing the canonical
            product UI.
          </p>
        </div>
        <div className="board-principles">
          <div>
            <strong>NOW / NEXT</strong>
            <span>One Current. Expected stop, not GPS confirmation.</span>
          </div>
          <div>
            <strong>FULL DAY PLAN</strong>
            <span>Remaining itinerary stays in the same scroll.</span>
          </div>
          <div>
            <strong>EXPLICIT CHOICES</strong>
            <span>No silent skip, transfer, or auto-complete.</span>
          </div>
        </div>
      </section>
      <section className="board-workspace">
        <aside className="coverage-panel">
          <div className="coverage-title">
            <h2>State coverage</h2>
            <span>{states.length} states</span>
          </div>
          {Object.entries(grouped).map(([city, cityStates]) => (
            <div key={city} className="coverage-group">
              <p>{city}</p>
              {cityStates.map((item) => (
                <button
                  key={item.id}
                  className={item.id === selectedId ? 'selected' : ''}
                  onClick={() => {
                    setSelectedId(item.id);
                    setFeedback('');
                  }}
                >
                  <span>{states.indexOf(item) + 1}</span>
                  <span>{item.title.replace(`${city} · `, '')}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="board-preview-column">
          <div className="preview-toolbar">
            <div>
              <p className="board-kicker">SELECTED STATE</p>
              <h2>{state.title}</h2>
            </div>
            <select
              aria-label="Select design state"
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setFeedback('');
              }}
            >
              {states.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {index + 1}. {item.title}
                </option>
              ))}
            </select>
          </div>
          <div className="phone-stage">
            <div className="phone-frame">
              <StatePreview
                key={state.id}
                state={state}
                feedback={feedback}
                onFeedback={setFeedback}
              />
            </div>
          </div>
          <div className="state-description">
            <div>
              <strong>Interaction contract</strong>
              <p>{state.description}</p>
            </div>
            <div>
              <strong>Visible actions</strong>
              <p>{state.actions.join(' · ')}</p>
            </div>
          </div>
        </section>
      </section>
      <footer className="board-footer">
        <span>Your AI plans. RouteRunner executes.</span>
        <span>Canonical visual baseline preserved · Review artifact only</span>
      </footer>
    </main>
  );
}
