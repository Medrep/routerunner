export const stops = [
  {
    name: 'Nyhavn',
    kind: 'must',
    minutes: 30,
    travel: 0,
    mode: 'walk',
    distance: '',
    note: 'Start beside the colourful harbour. Take a slow walk along the waterfront before heading north.',
    x: 215,
    y: 374,
    lat: 55.6797,
    lng: 12.5909,
  },
  {
    name: 'Amalienborg',
    kind: 'must',
    minutes: 25,
    travel: 12,
    mode: 'walk',
    distance: '850 m',
    note: 'Walk through the palace square. Leave a few minutes to look back toward the waterfront.',
    x: 232,
    y: 285,
    lat: 55.6841,
    lng: 12.593,
  },
  {
    name: 'Marble Church',
    kind: 'regular',
    minutes: 15,
    travel: 5,
    mode: 'walk',
    distance: '350 m',
    note: 'Pause at the church and take in the dome. Keep the visit short to leave time for the harbour.',
    x: 171,
    y: 249,
    lat: 55.6847,
    lng: 12.5895,
  },
  {
    name: 'Kastellet',
    kind: 'regular',
    minutes: 20,
    travel: 12,
    mode: 'walk',
    distance: '900 m',
    note: 'Follow the green ramparts around the star-shaped fortress. A short loop gives you a quiet break from the city.',
    x: 247,
    y: 161,
    lat: 55.6912,
    lng: 12.5937,
  },
  {
    name: 'Little Mermaid',
    kind: 'must',
    minutes: 15,
    travel: 14,
    mode: 'walk',
    distance: '1.1 km',
    note: 'Follow the waterfront to the statue. Allow a little time for a photo, then decide whether Reffen still fits.',
    x: 316,
    y: 111,
    lat: 55.6929,
    lng: 12.5993,
  },
  {
    name: 'Reffen',
    kind: 'optional',
    minutes: 35,
    travel: 18,
    mode: 'ferry',
    distance: 'Harbour Bus 992',
    note: 'An optional food stop across the harbour. Skip it if time is tight; Christiania and the 18:30 hard stop come first.',
    x: 449,
    y: 174,
    lat: 55.6934,
    lng: 12.6106,
  },
  {
    name: 'Christiania',
    kind: 'must',
    minutes: 35,
    travel: 19,
    mode: 'transit',
    distance: 'Transit + walk',
    note: 'The last sightseeing stop of the day. Wrap up by 18:30, then switch to your airport journey.',
    x: 367,
    y: 428,
    lat: 55.6736,
    lng: 12.5977,
  },
] as const;

export const demoScenarios = [
  ['A', 'A · Trip start'],
  ['B', 'B · Normal execution'],
  ['C', 'C · Schedule tight'],
  ['F', 'F · Reffen skipped · back on plan'],
  ['D', 'D · Fullscreen map'],
  ['E', 'E · Stop expanded'],
  ['risk', 'Deadline at risk'],
  ['complete', 'Trip completed'],
] as const;

export type Trip = {
  current: number;
  clock: number;
  started: boolean;
  skipped: boolean;
  saved: number[];
  extra: number;
  ended: boolean;
};
export const normal = (): Trip => ({
  current: 3,
  clock: 912,
  started: true,
  skipped: false,
  saved: [],
  extra: 0,
  ended: false,
});
export function scenario(key: string): Trip {
  if (key === 'A')
    return { ...normal(), current: 0, clock: 600, started: false };
  if (key === 'C') return { ...normal(), current: 4, clock: 955, extra: 15 };
  if (key === 'F')
    return { ...normal(), current: 4, clock: 955, skipped: true, extra: 0 };
  if (key === 'risk')
    return { ...normal(), current: 4, clock: 1005, extra: 15 };
  if (key === 'complete') return { ...normal(), current: 7, clock: 1068 };
  return normal();
}
export const time = (minutes: number) =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
export function nextIndex(t: Trip) {
  let n = t.current + 1;
  while (n < 7 && ((n === 5 && t.skipped) || t.saved.includes(n))) n++;
  return n;
}
export function leg(index: number, t: Trip) {
  if (index === 6 && t.skipped)
    return {
      minutes: 37,
      mode: 'transit',
      label: 'Transit + walk',
      distance: '',
    };
  const s = stops[index];
  return {
    minutes: s.travel,
    mode: s.mode,
    label: s.mode === 'walk' ? 'Walk' : s.distance,
    distance: s.mode === 'walk' ? s.distance : '',
  };
}
export function remaining(t: Trip) {
  if (t.current >= 7 || t.ended) return 0;
  let mins = stops[t.current].minutes + t.extra;
  for (let i = t.current + 1; i < 7; i++) {
    if ((i === 5 && t.skipped) || t.saved.includes(i)) continue;
    mins += stops[i].minutes + leg(i, t).minutes;
  }
  return mins;
}
export function advance(t: Trip): Trip {
  if (!t.started) return { ...t, started: true };
  if (t.current >= 7 || t.ended) return t;
  const n = nextIndex(t);
  return {
    ...t,
    current: n,
    clock:
      t.clock +
      stops[t.current].minutes +
      t.extra +
      (n < 7 ? leg(n, t).minutes : 0),
    extra: 0,
  };
}
export function skipReffen(t: Trip): Trip {
  if (t.skipped || t.current > 5 || t.ended) return t;
  if (t.current === 5)
    return {
      ...t,
      skipped: true,
      current: 6,
      clock: t.clock + stops[6].travel,
      extra: 0,
    };
  return { ...t, skipped: true };
}
export function stopStatus(i: number, t: Trip) {
  if (t.saved.includes(i)) return 'saved';
  if (i === 5 && t.skipped) return 'skipped';
  if (i < t.current) return 'completed';
  if (!t.started || t.ended) return 'future';
  if (i === t.current) return 'current';
  if (i === nextIndex(t)) return 'next';
  return 'future';
}
