import { createStopId, createStopVisitPlanItemId } from '../../domain/index.ts';
import type { Trip } from '../../domain/index.ts';

export const krakowStopIds = {
  placWolnica: createStopId('krk-plac-wolnica'),
  mitZajezdnia: createStopId('krk-mit-zajezdnia'),
  halaTargowa: createStopId('krk-hala-targowa'),
  rondoGrzegorzeckie: createStopId('krk-rondo-grzegorzeckie'),
  krakowGlowny: createStopId('krk-krakow-glowny'),
} as const;

export const krakowMitVisitPlanItemIds = {
  citySystems: createStopVisitPlanItemId('krk-mit-city-systems'),
  movementUrbanForm: createStopVisitPlanItemId('krk-mit-movement-urban-form'),
  communicationComputing: createStopVisitPlanItemId(
    'krk-mit-communication-computing',
  ),
  labHistoricTrams: createStopVisitPlanItemId('krk-mit-lab-historic-trams'),
} as const;

/**
 * Canonical 12 September 2026 Kraków RR-FIELD-06 fixture. The museum's
 * visitPlan is an ordered attention plan inside one global Stop, not prepared
 * floor routing. Global Legs deliberately omit unverified travel estimates.
 */
export const krakowField06Trip: Trip = {
  id: 'krk-field06-structured-stop-visit-plan',
  title: 'Kraków · Structured Stop Visit Plan Field Test',
  city: 'Kraków',
  timeZone: 'Europe/Warsaw',
  startDate: '2026-09-12',
  endDate: '2026-09-12',
  stops: [
    {
      id: krakowStopIds.placWolnica,
      name: 'Plac Wolnica',
      latitude: 50.04875,
      longitude: 19.944167,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 10,
    },
    {
      id: krakowStopIds.mitZajezdnia,
      name: 'Muzeum Inżynierii i Techniki — Zajezdnia',
      shortName: 'MIT — Zajezdnia',
      visitBrief:
        'Use this ordered attention plan to focus the museum visit; it is not a verified physical route through the museum.',
      visitPlan: {
        items: [
          {
            id: krakowMitVisitPlanItemIds.citySystems,
            order: 10,
            name: 'City systems',
            visitBrief:
              'Start with the systems that keep a city running: water, energy, heating and related infrastructure.',
            highlights: [
              'Hydrotechnology',
              'Energy engineering',
              'Heat and gas engineering',
            ],
          },
          {
            id: krakowMitVisitPlanItemIds.movementUrbanForm,
            order: 20,
            name: 'Movement & urban form',
            visitBrief:
              'Focus next on how technology shapes the physical city and how people move through it.',
            highlights: ['Architecture', 'Urban planning', 'Mobility'],
          },
          {
            id: krakowMitVisitPlanItemIds.communicationComputing,
            order: 30,
            name: 'Communication & computing',
            visitBrief:
              'Look for the progression from early communication equipment to electronic computing.',
            highlights: [
              'Early Polish telephones',
              'Historic radio equipment',
              'Odra 1305 computer',
            ],
          },
          {
            id: krakowMitVisitPlanItemIds.labHistoricTrams,
            order: 40,
            name: 'LAB & historic trams',
            visitBrief:
              'Finish with a few hands-on LAB experiments and the historic tram collection before leaving the museum.',
            highlights: ['LAB experiments', 'Historic tram cars'],
          },
        ],
      },
      latitude: 50.0498,
      longitude: 19.946775,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 120,
    },
    {
      id: krakowStopIds.halaTargowa,
      name: 'Hala Targowa',
      latitude: 50.058056,
      longitude: 19.949306,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 15,
    },
    {
      id: krakowStopIds.rondoGrzegorzeckie,
      name: 'Rondo Grzegórzeckie',
      latitude: 50.05765,
      longitude: 19.95907,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 5,
    },
    {
      id: krakowStopIds.krakowGlowny,
      name: 'Kraków Główny',
      latitude: 50.06842,
      longitude: 19.94789,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 5,
    },
  ],
  days: [
    {
      id: 'krk-field06-day-1',
      date: '2026-09-12',
      title: 'Kraków',
      plan: [
        { stopId: krakowStopIds.placWolnica, order: 10 },
        { stopId: krakowStopIds.mitZajezdnia, order: 20 },
        { stopId: krakowStopIds.halaTargowa, order: 30 },
        { stopId: krakowStopIds.rondoGrzegorzeckie, order: 40 },
        { stopId: krakowStopIds.krakowGlowny, order: 50 },
      ],
    },
  ],
  legs: [
    {
      id: 'krk-plac-wolnica-mit-zajezdnia',
      fromStopId: krakowStopIds.placWolnica,
      toStopId: krakowStopIds.mitZajezdnia,
      mode: 'walk',
    },
    {
      id: 'krk-mit-zajezdnia-hala-targowa',
      fromStopId: krakowStopIds.mitZajezdnia,
      toStopId: krakowStopIds.halaTargowa,
      mode: 'walk',
    },
    {
      id: 'krk-hala-targowa-rondo-grzegorzeckie',
      fromStopId: krakowStopIds.halaTargowa,
      toStopId: krakowStopIds.rondoGrzegorzeckie,
      mode: 'walk',
    },
    {
      id: 'krk-rondo-grzegorzeckie-krakow-glowny',
      fromStopId: krakowStopIds.rondoGrzegorzeckie,
      toStopId: krakowStopIds.krakowGlowny,
      mode: 'transit',
    },
  ],
};
