import {
  createPostDayDestinationId,
  createStopId,
} from '../../domain/index.ts';
import type { PostDayDestination, Trip } from '../../domain/index.ts';

export const copenhagenStopIds = {
  nyhavn: createStopId('copenhagen-nyhavn'),
  amalienborg: createStopId('copenhagen-amalienborg'),
  marbleChurch: createStopId('copenhagen-marble-church'),
  kastellet: createStopId('copenhagen-kastellet'),
  littleMermaid: createStopId('copenhagen-little-mermaid'),
  reffen: createStopId('copenhagen-reffen'),
  christiania: createStopId('copenhagen-christiania'),
} as const;

export const copenhagenAirport: PostDayDestination = {
  id: createPostDayDestinationId('copenhagen-airport'),
  name: 'Copenhagen Airport',
  navigationTarget: { address: 'Copenhagen Airport' },
  mode: 'transit',
  // The frozen plan establishes no airport arrival time or travel duration.
};

/**
 * Canonical field-test data. Route, coordinates and prepared leg inputs follow
 * the frozen Copenhagen plan. Control Tower establishes the date, canSkip for
 * every stop, and the strict buffer-below-30 Reffen rule. No runtime state.
 */
export const copenhagenTrip: Trip = {
  id: 'copenhagen',
  title: 'Copenhagen',
  city: 'Copenhagen',
  timeZone: 'Europe/Copenhagen',
  startDate: '2026-09-08',
  endDate: '2026-09-08',
  stops: [
    {
      id: copenhagenStopIds.nyhavn,
      name: 'Nyhavn',
      latitude: 55.6797,
      longitude: 12.5909,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 30,
    },
    {
      id: copenhagenStopIds.amalienborg,
      name: 'Amalienborg',
      latitude: 55.6841,
      longitude: 12.593,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 25,
    },
    {
      id: copenhagenStopIds.marbleChurch,
      name: 'Marble Church',
      latitude: 55.6847,
      longitude: 12.5895,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 15,
    },
    {
      id: copenhagenStopIds.kastellet,
      name: 'Kastellet',
      latitude: 55.6912,
      longitude: 12.5937,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
    },
    {
      id: copenhagenStopIds.littleMermaid,
      name: 'Little Mermaid',
      latitude: 55.6929,
      longitude: 12.5993,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 15,
    },
    {
      id: copenhagenStopIds.reffen,
      name: 'Reffen',
      latitude: 55.6934,
      longitude: 12.6106,
      priority: 'optional',
      canSkip: true,
      plannedVisitMinutes: 35,
    },
    {
      id: copenhagenStopIds.christiania,
      name: 'Christiania',
      latitude: 55.6736,
      longitude: 12.5977,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 35,
    },
  ],
  days: [
    {
      id: 'copenhagen-day-1',
      date: '2026-09-08',
      title: 'Copenhagen',
      plannedStartTime: '10:00',
      hardEndTime: '18:30',
      plan: [
        { stopId: copenhagenStopIds.nyhavn, order: 1 },
        { stopId: copenhagenStopIds.amalienborg, order: 2 },
        { stopId: copenhagenStopIds.marbleChurch, order: 3 },
        { stopId: copenhagenStopIds.kastellet, order: 4 },
        { stopId: copenhagenStopIds.littleMermaid, order: 5 },
        { stopId: copenhagenStopIds.reffen, order: 6 },
        { stopId: copenhagenStopIds.christiania, order: 7 },
      ],
      postDayDestination: copenhagenAirport,
    },
  ],
  legs: [
    {
      id: 'copenhagen-nyhavn-amalienborg',
      fromStopId: copenhagenStopIds.nyhavn,
      toStopId: copenhagenStopIds.amalienborg,
      mode: 'walk',
      plannedDurationMinutes: 12,
      distanceMeters: 850,
    },
    {
      id: 'copenhagen-amalienborg-marble-church',
      fromStopId: copenhagenStopIds.amalienborg,
      toStopId: copenhagenStopIds.marbleChurch,
      mode: 'walk',
      plannedDurationMinutes: 5,
      distanceMeters: 350,
    },
    {
      id: 'copenhagen-marble-church-kastellet',
      fromStopId: copenhagenStopIds.marbleChurch,
      toStopId: copenhagenStopIds.kastellet,
      mode: 'walk',
      plannedDurationMinutes: 12,
      distanceMeters: 900,
    },
    {
      id: 'copenhagen-kastellet-little-mermaid',
      fromStopId: copenhagenStopIds.kastellet,
      toStopId: copenhagenStopIds.littleMermaid,
      mode: 'walk',
      plannedDurationMinutes: 14,
      distanceMeters: 1100,
    },
    {
      id: 'copenhagen-little-mermaid-reffen',
      fromStopId: copenhagenStopIds.littleMermaid,
      toStopId: copenhagenStopIds.reffen,
      mode: 'ferry',
      plannedDurationMinutes: 18,
      instruction: 'Harbour Bus 992',
    },
    {
      id: 'copenhagen-reffen-christiania',
      fromStopId: copenhagenStopIds.reffen,
      toStopId: copenhagenStopIds.christiania,
      mode: 'transit',
      plannedDurationMinutes: 19,
      instruction: 'Transit + walk',
    },
    // Prepared Reffen bypass; selecting this leg belongs to later execution.
    {
      id: 'copenhagen-little-mermaid-christiania',
      fromStopId: copenhagenStopIds.littleMermaid,
      toStopId: copenhagenStopIds.christiania,
      mode: 'transit',
      plannedDurationMinutes: 37,
      instruction: 'Transit + walk',
    },
  ],
  rules: [
    {
      id: 'copenhagen-reffen-buffer-below-30',
      type: 'buffer_below',
      thresholdMinutes: 30,
      action: { type: 'recommend_skip', stopId: copenhagenStopIds.reffen },
    },
  ],
};
