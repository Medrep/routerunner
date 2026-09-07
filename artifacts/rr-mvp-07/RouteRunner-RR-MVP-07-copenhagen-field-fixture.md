# RouteRunner RR-MVP-07 — Copenhagen Field-Test Fixture

## Repository and commits

- Repository: `/Users/alexkucheruk/Projects/RouteRunner`
- Branch: `main`
- Baseline commit: `2bd4dafdf1c5920dd8d5d960e21d351ba80853b3`
- Implementation commit: `ffa4ec3acc84a828d3d83c878c331fb870def36a`
- Production fixture: `data/trips/copenhagen.ts`

## Final production itinerary

- Date: `2026-09-08`
- Timezone: `Europe/Copenhagen`
- Planned city start: `10:30`
- Hard sightseeing cutoff: `18:30`
- Execution days: 1
- Sightseeing stops: 16

The authoritative `DayPlanItem.order` sequence is:

1. `copenhagen-nyhavn` (10)
2. `copenhagen-amalienborg` (20)
3. `copenhagen-marble-church` (30)
4. `copenhagen-gefion-fountain` (40)
5. `copenhagen-kastellet` (50)
6. `copenhagen-little-mermaid` (60)
7. `copenhagen-reffen` (70)
8. `copenhagen-christianshavn` (80)
9. `copenhagen-christiania` (90)
10. `copenhagen-black-diamond` (100)
11. `copenhagen-christiansborg` (110)
12. `copenhagen-christiansborg-tower` (120)
13. `copenhagen-stroget-old-centre` (130)
14. `copenhagen-round-tower-exterior` (140)
15. `copenhagen-rosenborg-kings-garden` (150)
16. `copenhagen-torvehallerne` (160)

The accepted semantic IDs for the original seven stops were preserved. Nine
new semantic IDs complete the final itinerary. All sightseeing stops retain
the accepted `canSkip: true` execution capability, while only Reffen has
planning priority `optional`.

The production `/` imports this fixture directly. The old seven-stop fixture is
therefore no longer a production source of truth. The separate frozen
`design-reference/copenhagen-fixtures.ts` and 27-state `/design-board` harness
were not changed.

## Final-plan fidelity

- Amalienborg is exterior/square only and has no timed guard-change event or
  guard-change wait.
- Marmorkirken, Gefion Fountain, Christianshavn, Black Diamond,
  Christiansborg exterior, Christiansborg Tower, Strøget / Old Centre, Round
  Tower exterior, Rosenborg + King's Garden, and Torvehallerne are distinct
  canonical stops.
- Christiansborg Tower retains the prepared `11:00`–`21:00` time window and a
  40-minute visit including reasonable queue allowance; there is no queue
  engine.
- Torvehallerne is the final sightseeing stop and retains the prepared weekday
  closing window ending at `19:00`.
- No bicycle, reserve, free-time, airport-transfer, or flight stop exists.
- Copenhagen Airport (CPH) remains a `PostDayDestination`, targets arrival at
  `19:00`, and is absent from the sightseeing plan, stop executions, legs, and
  ordinary Current navigation.

## Reffen branch and prepared map data

The static `buffer_below` rule remains unique and recommends skipping
`copenhagen-reffen` below a threshold of exactly 30 minutes. It is prepared
Trip data only and is not evaluated dynamically.

Prepared normal branch:

`Little Mermaid → ferry → Reffen → ferry → Christianshavn`

Prepared bypass:

`Little Mermaid → transit → Christianshavn`

The accepted Leg model has endpoints but no route-role metadata. The bypass is
therefore represented as one additional non-adjacent Leg; normal adjacent legs
continue to drive the map view. Manual Skip uses canonical plan eligibility and
was verified to advance Reffen directly to Christianshavn.

There are 16 prepared Legs: 13 walking, 1 transit bypass, and 2 ferry legs.
Fifteen adjacent main-route legs become map connectors. No Leg has path
geometry. The existing RR-MVP-06 map view consequently labels every rendered
connection `schematic-endpoints`; no street-following geometry was invented and
no live routing provider was called.

## Coordinates

All 16 sightseeing stops have WGS84 latitude/longitude values. Existing
accepted coordinates were retained where appropriate. New or refined points
were checked against VisitCopenhagen, Wikidata, OpenStreetMap-derived map data,
and Royal Danish Library place data, then bounded by a central-Copenhagen
sanity test (`55.67`–`55.70` latitude, `12.56`–`12.62` longitude).

Representative large-area choices:

- Christianshavn: canal/Christianshavns Torv area reference point.
- Strøget / Old Centre: Wikidata pedestrian-zone reference point.
- Rosenborg + King's Garden: Rosenborg exterior/garden-edge reference point.

Primary verification references included:

- VisitCopenhagen: Marmorkirken, Gefion Fountain, Christiansborg Tower,
  King's Garden, and Torvehallerne.
- Wikidata: Amalienborg, Little Mermaid, Reffen, Christiania,
  Christiansborg, Strøget, and Rosenborg.
- OpenStreetMap-derived reference points: Kastellet, Christianshavn, Round
  Tower, and Reffen.
- Royal Danish Library / DBpedia geographic record: Black Diamond.

The final extent proves Reffen is the easternmost point, Torvehallerne is the
westernmost, Christianshavn is the southernmost, and the northern harbour route
is included. Latitude/longitude orientation and Copenhagen bounds pass.

## Validation and deterministic regressions

- `validateTrip(copenhagenTrip)`: PASS with no errors.
- Unique Stop, day, Leg, Rule, plan placement, and order identities: PASS.
- Every plan StopId and Leg endpoint resolves: PASS.
- Reffen rule target resolves to canonical Reffen: PASS.
- Airport sightseeing-identity separation: PASS.
- Field-fixture test file: PASS, 10 tests.
- Dedicated RR-MVP-07 test file: PASS, 6 tests.
- Execution transition test file: PASS, 14 tests.
- RR-MVP-06 map/navigation test file: PASS, 24 tests.
- Persistence regression test file: PASS, 56 tests.
- Full suite: PASS, 155 tests.

Start Day establishes Nyhavn as the sole Current and Amalienborg as Next.
Completing stops advances through Nyhavn, Amalienborg, Marmorkirken, Gefion
Fountain, Kastellet, Little Mermaid, then Reffen in authoritative order. Manual
Reffen Skip advances to Christianshavn. The expanded execution state saves and
restores through the existing version-1 persistence boundary.

Start & Navigate was deterministically verified to start and persist the day,
then build the coordinate-based Google Maps target for Nyhavn. After Nyhavn is
Done, ordinary Current navigation targets Amalienborg. Current remains derived
solely from `currentStopId`; transient GPS is a separate map-view field.

The production map view derives 16 markers keyed by StopId, 15 explicit
schematic main-route connectors, data-driven optional Reffen identity,
Current/Next status, independent user-location data, and the full expanded
bounds input. No positional Reffen special case was introduced.

## Browser evidence and Mapbox token boundary

- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` in `.env.local`: NO (`.env.local` absent).
- Token in process environment: NO.
- Real token committed: NO.
- `.env.local` tracked: NO; `.env*` remains ignored except `.env.example`.
- Real Mapbox basemap smoke: NOT PERFORMED — TOKEN UNAVAILABLE.
- Real Mapbox authentication, tiles, pan, zoom, fit, and marker-style smoke:
  NOT TESTED.
- GPS browser smoke: NOT PERFORMED.

A no-token local browser sanity check loaded production `/` successfully and
visibly showed the 16-stop final itinerary, explicit missing-token map state,
Nyhavn first, Amalienborg next, and the 18:30 cutoff. Start Day made Nyhavn
Current. Done Nyhavn made Amalienborg Current and changed the Google Maps target
to `55.6841,12.593`. This is application-regression evidence only and is not a
substitute for real Mapbox rendering.

REAL MAPBOX SMOKE NOT PERFORMED — TOKEN UNAVAILABLE.

## Build and quality

- `npm test`: PASS, 155/155.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; `/` and `/design-board` emitted.
- `npx oxfmt --check .`: PASS, 109 files.
- Focused Oxlint on all changed implementation/test files: PASS, zero
  diagnostics.
- Full repository Oxlint JSON scan: expected inherited failure, exactly 22
  diagnostics across 14 files; no RR-MVP-07 diagnostic.
- `git diff --check`: PASS.
- Secret scan of implementation diff: PASS; no public token value.

## Scope and contradiction scan

- Production uses the final 16-stop plan: YES.
- Guard change absent: YES.
- Reffen is the sole planning-optional stop: YES.
- Reffen threshold remains 30 minutes: YES.
- Reffen Skip continues to Christianshavn: YES.
- Airport remains post-day only: YES.
- Hard day cutoff remains 18:30: YES.
- Bicycle and reserve-time stops absent: YES.
- `DayPlanItem.order` remains authoritative: YES.
- `currentStopId` remains sole Current authority: YES.
- GPS remains transient and unpersisted: YES.
- New persistence fields: NONE.
- Live routing or route-service calls: NONE.
- Schedule calculation or rule evaluation: NONE.
- Arrival detection or advanced lifecycle: NONE.
- Domain schema changes: NONE.
- Frozen design-board semantic changes: NONE.
- Mapbox token tracked: NO.

## Deferred functionality

- Real Mapbox browser smoke after a valid public token is locally configured
- Schedule projection, ETA, remaining buffer, health, and Reffen rule evaluation
- Route optimization, live directions, and timetable lookup
- Automated shortening, queue logic, and arrival detection
- Background GPS and geofencing
- Advanced execution, End Day, completion lifecycle, leftover resolution, and
  day switching
- Post-trip Airport navigation
- Rome

## Status

RR-MVP-07 IMPLEMENTATION COMPLETE — FIELD SMOKE BLOCKED
