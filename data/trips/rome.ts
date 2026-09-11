import {
  createPostDayDestinationId,
  createStopId,
  createStopVisitPlanItemId,
} from '../../domain/index.ts';
import type { PostDayDestination, Trip } from '../../domain/index.ts';

export const romeStopIds = {
  ciampinoAirport: createStopId('rome-ciampino-airport'),
  spanishSteps: createStopId('rome-spanish-steps'),
  treviFountain: createStopId('rome-trevi-fountain'),
  pantheon: createStopId('rome-pantheon'),
  piazzaNavona: createStopId('rome-piazza-navona'),
  vaticanMuseums: createStopId('rome-vatican-museums'),
  stPetersSquare: createStopId('rome-st-peters-square'),
  castelSantAngelo: createStopId('rome-castel-sant-angelo'),
  piazzaVenezia: createStopId('rome-piazza-venezia'),
  laCasaDiElena: createStopId('rome-la-casa-di-elena'),
  stPetersBasilica: createStopId('rome-st-peters-basilica'),
  colosseum: createStopId('rome-colosseum'),
  forumPalatine: createStopId('rome-forum-palatine'),
  circusMaximus: createStopId('rome-circus-maximus'),
  orangeGarden: createStopId('rome-orange-garden'),
  aventineKeyhole: createStopId('rome-aventine-keyhole'),
  teatroGhetto: createStopId('rome-teatro-ghetto'),
  tiberIsland: createStopId('rome-tiber-island'),
  trastevere: createStopId('rome-trastevere'),
} as const;

export const romeDayIds = {
  day1: 'rome-day-1',
  day2: 'rome-day-2',
} as const;

export const romeFiumicinoAirport: PostDayDestination = {
  id: createPostDayDestinationId('rome-fiumicino-airport'),
  name: 'Rome Fiumicino Airport',
  navigationTarget: { latitude: 41.8003, longitude: 12.2389 },
  targetArrivalTime: '18:45',
  plannedTravelMinutes: 60,
  mode: 'transit',
};

/**
 * Owner-approved 16–17 September 2026 Rome field-test itinerary. Fiumicino is
 * post-day navigation rather than sightseeing execution, and the Day-1
 * Colosseum exterior is represented only by a route-shaping waypoint.
 */
export const romeTrip: Trip = {
  id: 'rome-field-test-2026',
  title: 'Rome — Vatican, Historic Centre & Ancient Rome',
  city: 'Rome',
  timeZone: 'Europe/Rome',
  startDate: '2026-09-16',
  endDate: '2026-09-17',
  stops: [
    {
      id: romeStopIds.ciampinoAirport,
      name: 'Rome Ciampino Airport',
      shortName: 'CIA',
      kind: 'logistics',
      logisticsRole: 'start',
      latitude: 41.7999,
      longitude: 12.5949,
      priority: 'must',
      canSkip: false,
      plannedVisitMinutes: 30,
      note: 'Arrival processing with hand luggage; continue directly into central Rome.',
    },
    {
      id: romeStopIds.spanishSteps,
      name: 'Spanish Steps / Piazza di Spagna',
      shortName: 'Spanish Steps',
      latitude: 41.906,
      longitude: 12.4828,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
      note: 'First sightseeing stop after the airport transfer.',
    },
    {
      id: romeStopIds.treviFountain,
      name: 'Trevi Fountain',
      shortName: 'Trevi',
      latitude: 41.9009,
      longitude: 12.4833,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
      note: 'Short daylight visit; no need to linger if crowded.',
    },
    {
      id: romeStopIds.pantheon,
      name: 'Pantheon',
      shortName: 'Pantheon',
      latitude: 41.8986,
      longitude: 12.4769,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 30,
      note: 'Go inside, not exterior-only.',
      visitBrief:
        'Read the building from the portico, then focus on the rotunda, dome, oculus and principal interior elements.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-pantheon-portico-entrance'),
            order: 10,
            name: 'Portico and entrance',
            visitBrief:
              'Read the building from outside before entering. Allow about 5 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-pantheon-rotunda-dome'),
            order: 20,
            name: 'Rotunda + dome + oculus',
            visitBrief:
              'Focus on the scale, coffering and geometry. Allow about 15 minutes.',
            highlights: ['Rotunda scale', 'Coffered dome', 'Oculus geometry'],
          },
          {
            id: createStopVisitPlanItemId('rome-pantheon-interior-circuit'),
            order: 30,
            name: 'Interior circuit',
            visitBrief:
              'See the floor, drainage and oculus relationship, tombs and major side elements. Allow about 10 minutes.',
          },
        ],
      },
    },
    {
      id: romeStopIds.piazzaNavona,
      name: 'Piazza Navona',
      shortName: 'Navona',
      latitude: 41.8992,
      longitude: 12.4731,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 15,
      note: 'Short walk-through before lunch.',
    },
    {
      id: romeStopIds.vaticanMuseums,
      name: 'Vatican Museums',
      shortName: 'Vatican Museums',
      latitude: 41.907,
      longitude: 12.4535,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 270,
      note: 'Fixed 15:00 reservation; target arrival at the entrance is 14:30.',
      timeConstraint: { type: 'fixed_time', start: '15:00' },
      visitBrief:
        'Follow the prepared major-works sequence while preserving dedicated time for the Raphael Rooms and Sistine Chapel.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-vatican-pinacoteca'),
            order: 10,
            name: 'Pinacoteca Vaticana',
            visitBrief:
              'Focus on Leonardo, Raphael, Caravaggio and other major works. Allow about 40–45 minutes.',
            highlights: ['Leonardo', 'Raphael', 'Caravaggio'],
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-pio-clementino'),
            order: 20,
            name: 'Museo Pio Clementino',
            visitBrief:
              'Focus on the principal classical sculpture. Allow about 40–45 minutes.',
            highlights: ['Laocoön', 'Apollo Belvedere', 'Belvedere Torso'],
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-chiaramonti'),
            order: 30,
            name: 'Chiaramonti / Braccio Nuovo',
            visitBrief:
              'See the Roman sculpture and Augustus of Prima Porta. Allow about 20 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-etruscan'),
            order: 40,
            name: 'Gregorian Etruscan Museum',
            visitBrief:
              'Visit selectively and include the view toward the original Bramante spiral staircase. Allow about 20 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-galleries'),
            order: 50,
            name: 'Gallery sequence',
            visitBrief:
              'Continue through the Candelabra, Tapestries and Geographical Maps galleries. Allow about 35 minutes total.',
            highlights: [
              'Gallery of the Candelabra',
              'Gallery of Tapestries',
              'Gallery of Geographical Maps',
            ],
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-raphael-rooms'),
            order: 60,
            name: 'Raphael Rooms',
            visitBrief:
              'Give the papal apartments a focused visit. Allow about 35–40 minutes.',
            highlights: ['School of Athens'],
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-borgia-apartments'),
            order: 70,
            name: 'Borgia Apartments',
            visitBrief:
              'Make a short pass through the historic papal rooms. Allow about 15 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-sistine-chapel'),
            order: 80,
            name: 'Sistine Chapel',
            visitBrief:
              'Reserve dedicated viewing time instead of walking straight through. Allow about 25–30 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-vatican-momo-staircase'),
            order: 90,
            name: 'Momo spiral staircase / exit',
            visitBrief:
              'Finish at the modern double-helix staircase. Allow about 10 minutes.',
          },
        ],
      },
    },
    {
      id: romeStopIds.stPetersSquare,
      name: 'St Peter’s Square',
      shortName: 'St Peter’s Square',
      latitude: 41.9022,
      longitude: 12.4573,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
      note: 'Evening exterior visit only; the Basilica is reserved for Day 2.',
    },
    {
      id: romeStopIds.castelSantAngelo,
      name: 'Castel Sant’Angelo — exterior',
      shortName: 'Castel Sant’Angelo',
      latitude: 41.9031,
      longitude: 12.4663,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
      note: 'Exterior and river/bridge views; no museum entry.',
    },
    {
      id: romeStopIds.piazzaVenezia,
      name: 'Piazza Venezia',
      shortName: 'Piazza Venezia',
      latitude: 41.8958,
      longitude: 12.4823,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 10,
      note: 'Evening orientation stop before Via dei Fori Imperiali.',
    },
    {
      id: romeStopIds.laCasaDiElena,
      name: 'Accommodation — Via Prenestina 18',
      shortName: 'Accommodation',
      kind: 'logistics',
      logisticsRole: 'accommodation',
      latitude: 41.891373,
      longitude: 12.518824,
      priority: 'must',
      canSkip: false,
      plannedVisitMinutes: 10,
      note: 'Via Prenestina, 18, 00176 Roma, Italy. End of Day 1 and check-in.',
    },
    {
      id: romeStopIds.stPetersBasilica,
      name: 'St Peter’s Basilica',
      shortName: 'St Peter’s',
      latitude: 41.9022,
      longitude: 12.4539,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 60,
      note: 'Arrive shortly before opening/security; no dome climb.',
      visitBrief:
        'Use the early visit for a focused circuit of the principal interior without a dome ascent.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-basilica-pieta'),
            order: 10,
            name: 'Pietà',
            visitBrief:
              'Give the sculpture a dedicated close look. Allow about 10 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-basilica-nave'),
            order: 20,
            name: 'Central nave and overall scale',
            visitBrief:
              'Read the architecture and proportions. Allow about 10 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-basilica-baldachin'),
            order: 30,
            name: 'Bernini’s Baldachin + crossing',
            visitBrief:
              'Make this the major architectural and sculptural focus. Allow about 15 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-basilica-dome'),
            order: 40,
            name: 'Dome from inside',
            visitBrief:
              'Look upward from the church floor and crossing; do not ascend. Allow about 10 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-basilica-apse'),
            order: 50,
            name: 'Apse / remaining principal interior',
            visitBrief:
              'Complete the basic Basilica circuit. Allow about 15 minutes.',
          },
        ],
      },
    },
    {
      id: romeStopIds.colosseum,
      name: 'Colosseum',
      shortName: 'Colosseum',
      latitude: 41.8902,
      longitude: 12.4922,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 90,
      note: 'Ticket remains unresolved; 09:00 is a target, not a fixed constraint.',
      visitBrief:
        'Visit the interior properly; include Arena or Underground only when covered by the purchased ticket.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-colosseum-structural-circuit'),
            order: 10,
            name: 'Interior structural circuit',
            visitBrief:
              'Explore the main amphitheatre levels and views into the hypogeum. Allow about 45–50 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-colosseum-arena'),
            order: 20,
            name: 'Arena level',
            visitBrief:
              'Include only if covered by the purchased ticket. Allow about 15 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-colosseum-underground'),
            order: 30,
            name: 'Underground / hypogeum',
            visitBrief:
              'Include only if the preferred Underground ticket is booked. Allow about 20–25 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-colosseum-exit'),
            order: 40,
            name: 'Exit / orientation',
            visitBrief: 'Allow transition time toward the Forum entrance.',
          },
        ],
      },
    },
    {
      id: romeStopIds.forumPalatine,
      name: 'Roman Forum & Palatine Hill',
      shortName: 'Forum + Palatine',
      latitude: 41.8924,
      longitude: 12.4863,
      priority: 'must',
      canSkip: true,
      plannedVisitMinutes: 155,
      visitBrief:
        'Treat the Forum and Palatine as one archaeological block; optional SUPER sites must fit inside the global time.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-forum-core-route'),
            order: 10,
            name: 'Roman Forum core route',
            visitBrief:
              'Follow Via Sacra and the principal monumental core. Allow about 45–50 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-forum-curia-iulia'),
            order: 20,
            name: 'Curia Iulia',
            visitBrief: 'Visit if open and efficient. Allow about 10 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-forum-santa-maria-antiqua'),
            order: 30,
            name: 'Santa Maria Antiqua',
            visitBrief:
              'Include selectively if open and the queue is reasonable. Allow about 15 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-forum-palatine-hill'),
            order: 40,
            name: 'Palatine Hill',
            visitBrief:
              'See the imperial-palace remains and views over the Forum and Circus Maximus. Allow about 40–45 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-forum-domus-tiberiana'),
            order: 50,
            name: 'Domus Tiberiana',
            visitBrief:
              'Include selectively if open and naturally on the route. Allow about 15 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-forum-augustus-livia'),
            order: 60,
            name: 'House of Augustus / House of Livia',
            visitBrief:
              'Optional internal additions if open and they fit; do not extend the global archaeological block.',
          },
        ],
      },
    },
    {
      id: romeStopIds.circusMaximus,
      name: 'Circus Maximus',
      shortName: 'Circus Maximus',
      latitude: 41.8859,
      longitude: 12.4859,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
      note: 'Scale and orientation stop, not a long museum visit.',
    },
    {
      id: romeStopIds.orangeGarden,
      name: 'Orange Garden / Giardino degli Aranci',
      shortName: 'Orange Garden',
      latitude: 41.8851,
      longitude: 12.4806,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 20,
      note: 'Viewpoint and short rest.',
    },
    {
      id: romeStopIds.aventineKeyhole,
      name: 'Aventine Keyhole / Piazza dei Cavalieri di Malta',
      shortName: 'Keyhole',
      latitude: 41.8829,
      longitude: 12.478,
      priority: 'optional',
      canSkip: true,
      plannedVisitMinutes: 10,
      note: 'Brief stop and first sightseeing sacrifice under time pressure.',
    },
    {
      id: romeStopIds.teatroGhetto,
      name: 'Teatro di Marcello & Jewish Ghetto',
      shortName: 'Teatro + Ghetto',
      latitude: 41.8922,
      longitude: 12.4799,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 30,
      visitBrief:
        'Treat the theatre exterior, Portico d’Ottavia and immediate historic-quarter streets as one walking cluster.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-teatro-ghetto-teatro'),
            order: 10,
            name: 'Teatro di Marcello',
            visitBrief: 'See the theatre exterior. Allow about 10 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-teatro-ghetto-portico'),
            order: 20,
            name: 'Portico d’Ottavia',
            visitBrief: 'Explore the portico area. Allow about 10 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-teatro-ghetto-streets'),
            order: 30,
            name: 'Jewish Ghetto streets',
            visitBrief:
              'Take a short walk through the immediate historic quarter. Allow about 10 minutes.',
          },
        ],
      },
    },
    {
      id: romeStopIds.tiberIsland,
      name: 'Tiber Island / Isola Tiberina',
      shortName: 'Tiber Island',
      latitude: 41.8903,
      longitude: 12.4772,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 15,
      note: 'Short crossing and river stop on the natural route to Trastevere.',
    },
    {
      id: romeStopIds.trastevere,
      name: 'Trastevere / Santa Maria in Trastevere',
      shortName: 'Trastevere',
      latitude: 41.8894,
      longitude: 12.4709,
      priority: 'normal',
      canSkip: true,
      plannedVisitMinutes: 48,
      visitBrief:
        'Walk the neighbourhood and visit Santa Maria in Trastevere without creating additional destination hops.',
      visitPlan: {
        items: [
          {
            id: createStopVisitPlanItemId('rome-trastevere-streets-piazza'),
            order: 10,
            name: 'Trastevere streets and Piazza di Santa Maria',
            visitBrief:
              'Walk the neighbourhood rather than destination-hopping. Allow about 20–25 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-trastevere-basilica'),
            order: 20,
            name: 'Basilica di Santa Maria in Trastevere',
            visitBrief:
              'Enter if access is straightforward. Allow about 15–20 minutes.',
          },
          {
            id: createStopVisitPlanItemId('rome-trastevere-linger'),
            order: 30,
            name: 'Short neighbourhood linger',
            visitBrief:
              'Use the remaining time for a coffee, gelato or snack if useful.',
          },
        ],
      },
    },
  ],
  days: [
    {
      id: romeDayIds.day1,
      date: '2026-09-16',
      title: 'Historic Centre + Vatican + Rome After Dark',
      plan: [
        {
          stopId: romeStopIds.ciampinoAirport,
          order: 10,
          plannedStartTime: '09:40',
        },
        {
          stopId: romeStopIds.spanishSteps,
          order: 20,
          plannedStartTime: '11:30',
        },
        {
          stopId: romeStopIds.treviFountain,
          order: 30,
          plannedStartTime: '12:00',
        },
        { stopId: romeStopIds.pantheon, order: 40, plannedStartTime: '12:35' },
        {
          stopId: romeStopIds.piazzaNavona,
          order: 50,
          plannedStartTime: '13:15',
        },
        {
          stopId: romeStopIds.vaticanMuseums,
          order: 60,
          plannedStartTime: '15:00',
        },
        {
          stopId: romeStopIds.stPetersSquare,
          order: 70,
          plannedStartTime: '19:50',
        },
        {
          stopId: romeStopIds.castelSantAngelo,
          order: 80,
          plannedStartTime: '20:25',
        },
        {
          stopId: romeStopIds.piazzaVenezia,
          order: 90,
          plannedStartTime: '21:15',
        },
        {
          stopId: romeStopIds.laCasaDiElena,
          order: 100,
          plannedStartTime: '22:50',
        },
      ],
    },
    {
      id: romeDayIds.day2,
      date: '2026-09-17',
      title: 'St Peter’s + Ancient Rome + Aventine + Trastevere',
      plan: [
        {
          stopId: romeStopIds.stPetersBasilica,
          order: 10,
          plannedStartTime: '07:00',
        },
        { stopId: romeStopIds.colosseum, order: 20, plannedStartTime: '09:00' },
        {
          stopId: romeStopIds.forumPalatine,
          order: 30,
          plannedStartTime: '10:40',
        },
        {
          stopId: romeStopIds.circusMaximus,
          order: 40,
          plannedStartTime: '14:25',
        },
        {
          stopId: romeStopIds.orangeGarden,
          order: 50,
          plannedStartTime: '15:00',
        },
        {
          stopId: romeStopIds.aventineKeyhole,
          order: 60,
          plannedStartTime: '15:25',
        },
        {
          stopId: romeStopIds.teatroGhetto,
          order: 70,
          plannedStartTime: '15:55',
        },
        {
          stopId: romeStopIds.tiberIsland,
          order: 80,
          plannedStartTime: '16:32',
        },
        {
          stopId: romeStopIds.trastevere,
          order: 90,
          plannedStartTime: '16:57',
        },
      ],
      postDayDestination: romeFiumicinoAirport,
    },
  ],
  legs: [
    {
      id: 'rome-leg-d1-01',
      fromStopId: romeStopIds.ciampinoAirport,
      toStopId: romeStopIds.spanishSteps,
      mode: 'transit',
      plannedDurationMinutes: 75,
      instruction:
        'Take ATAC 520 from CIA, then transfer to Metro A for Spagna via Cinecittà.',
    },
    {
      id: 'rome-leg-d1-02',
      fromStopId: romeStopIds.spanishSteps,
      toStopId: romeStopIds.treviFountain,
      mode: 'walk',
      plannedDurationMinutes: 10,
    },
    {
      id: 'rome-leg-d1-03',
      fromStopId: romeStopIds.treviFountain,
      toStopId: romeStopIds.pantheon,
      mode: 'walk',
      plannedDurationMinutes: 12,
    },
    {
      id: 'rome-leg-d1-04',
      fromStopId: romeStopIds.pantheon,
      toStopId: romeStopIds.piazzaNavona,
      mode: 'walk',
      plannedDurationMinutes: 7,
    },
    {
      id: 'rome-leg-d1-05',
      fromStopId: romeStopIds.piazzaNavona,
      toStopId: romeStopIds.vaticanMuseums,
      mode: 'transit',
      plannedDurationMinutes: 25,
      instruction:
        'Use public transport; take a taxi instead if transit threatens the fixed 15:00 reservation.',
    },
    {
      id: 'rome-leg-d1-06',
      fromStopId: romeStopIds.vaticanMuseums,
      toStopId: romeStopIds.stPetersSquare,
      mode: 'walk',
      plannedDurationMinutes: 20,
      navigationWaypoints: [
        { latitude: 41.906457, longitude: 12.457801 },
        { latitude: 41.90455, longitude: 12.457737 },
      ],
      instruction:
        'Route outside the Vatican wall via Piazza del Risorgimento and Via di Porta Angelica.',
    },
    {
      id: 'rome-leg-d1-07',
      fromStopId: romeStopIds.stPetersSquare,
      toStopId: romeStopIds.castelSantAngelo,
      mode: 'walk',
      plannedDurationMinutes: 15,
      navigationWaypoints: [{ latitude: 41.9023, longitude: 12.462 }],
      instruction: 'Follow Via della Conciliazione toward the river.',
    },
    {
      id: 'rome-leg-d1-08',
      fromStopId: romeStopIds.castelSantAngelo,
      toStopId: romeStopIds.piazzaVenezia,
      mode: 'walk',
      plannedDurationMinutes: 30,
      navigationWaypoints: [{ latitude: 41.901193, longitude: 12.466507 }],
      instruction: 'Cross the Tiber via Ponte Sant’Angelo.',
    },
    {
      id: 'rome-leg-d1-09',
      fromStopId: romeStopIds.piazzaVenezia,
      toStopId: romeStopIds.laCasaDiElena,
      mode: 'walk',
      plannedDurationMinutes: 55,
      navigationWaypoints: [
        { latitude: 41.893327, longitude: 12.487 },
        { latitude: 41.8902, longitude: 12.4922 },
        { latitude: 41.894825, longitude: 12.491 },
      ],
      instruction:
        'Route via Via dei Fori Imperiali, the Colosseum exterior, and Piazza della Madonna dei Monti.',
    },
    {
      id: 'rome-leg-d2-02',
      fromStopId: romeStopIds.stPetersBasilica,
      toStopId: romeStopIds.colosseum,
      mode: 'transit',
      plannedDurationMinutes: 45,
      instruction:
        'Take Metro A from Ottaviano, transfer at Termini, then Metro B to Colosseo.',
    },
    {
      id: 'rome-leg-d2-03',
      fromStopId: romeStopIds.colosseum,
      toStopId: romeStopIds.forumPalatine,
      mode: 'walk',
      plannedDurationMinutes: 10,
    },
    {
      id: 'rome-leg-d2-04',
      fromStopId: romeStopIds.forumPalatine,
      toStopId: romeStopIds.circusMaximus,
      mode: 'walk',
      plannedDurationMinutes: 35,
      instruction:
        'Route through Monti for lunch; the 35 minutes excludes lunch dwell.',
    },
    {
      id: 'rome-leg-d2-05',
      fromStopId: romeStopIds.circusMaximus,
      toStopId: romeStopIds.orangeGarden,
      mode: 'walk',
      plannedDurationMinutes: 15,
      navigationWaypoints: [{ latitude: 41.884722, longitude: 12.480278 }],
      instruction: 'Approach Parco Savello via Via di Santa Sabina.',
    },
    {
      id: 'rome-leg-d2-06',
      fromStopId: romeStopIds.orangeGarden,
      toStopId: romeStopIds.aventineKeyhole,
      mode: 'walk',
      plannedDurationMinutes: 5,
      instruction: 'Continue to Piazza dei Cavalieri di Malta.',
    },
    {
      id: 'rome-leg-d2-07',
      fromStopId: romeStopIds.aventineKeyhole,
      toStopId: romeStopIds.teatroGhetto,
      mode: 'walk',
      plannedDurationMinutes: 20,
    },
    {
      id: 'rome-leg-d2-08',
      fromStopId: romeStopIds.teatroGhetto,
      toStopId: romeStopIds.tiberIsland,
      mode: 'walk',
      plannedDurationMinutes: 7,
      navigationWaypoints: [{ latitude: 41.890342, longitude: 12.479663 }],
      instruction: 'Force the route through Ponte Fabricio.',
    },
    {
      id: 'rome-leg-d2-09',
      fromStopId: romeStopIds.tiberIsland,
      toStopId: romeStopIds.trastevere,
      mode: 'walk',
      plannedDurationMinutes: 10,
      navigationWaypoints: [{ latitude: 41.890237, longitude: 12.477303 }],
      instruction: 'Cross the western channel through Ponte Cestio.',
    },
  ],
};
