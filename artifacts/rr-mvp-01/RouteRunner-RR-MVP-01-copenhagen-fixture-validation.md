# RouteRunner RR-MVP-01 Copenhagen Fixture + Validation

Status: IMPLEMENTATION COMPLETE — READY FOR CONTROL TOWER REVIEW.

## Repository and implementation

- Repository: `/Users/alexkucheruk/Projects/RouteRunner`
- Branch: `main`
- Baseline: `48ff8bb454e94102e3473318202b0909ab6ed30f`
- Initial working tree: clean; resumed the existing uncommitted validator work.
- Implementation commit: the single commit containing this report, titled
  `RR-MVP-01: add Copenhagen production fixture validation`.
  Resolve its hash with `git log -1 --format=%H -- artifacts/rr-mvp-01/RouteRunner-RR-MVP-01-copenhagen-fixture-validation.md`.
- Production fixture: `data/trips/copenhagen.ts`.
- Validator: `domain/trip/validate-trip.ts`, exported through `domain/index.ts`.
- Tests: `domain/__tests__/trip-validation.test.ts` and
  `domain/__tests__/copenhagen-fixture.test.ts`.
- `domain/trip/index.ts` exposes the validation function and result types.
- `package.json` runs all `domain/__tests__/*.test.ts` files using the existing
  native Node test runner. No dependency or lockfile change was needed.

## Authority and Copenhagen static data

Control Tower resolved the missing inputs explicitly: execution date 2026-09-08,
`canSkip: true` for all seven sightseeing stops, and the sole Reffen rule
`buffer_below` with `thresholdMinutes: 30` and `recommend_skip` targeting Reffen.
The intended condition is strictly buffer < 30. The prototype's inclusive
20-minute condition is not production authority and was not copied.
Schedule-health classification and rule eligibility/acknowledgement remain
future execution concerns; no evaluator or health calculation was added.

The frozen Copenhagen design and reference itinerary supply the route ordering,
coordinates, visit durations, priorities, and prepared movement information.
Reference `regular` maps to the accepted production `normal` priority.

| Stable StopId             | Name           | Priority | canSkip | Visit minutes | Latitude | Longitude |
| ------------------------- | -------------- | -------- | ------- | ------------- | -------- | --------- |
| copenhagen-nyhavn         | Nyhavn         | must     | true    | 30            | 55.6797  | 12.5909   |
| copenhagen-amalienborg    | Amalienborg    | must     | true    | 25            | 55.6841  | 12.593    |
| copenhagen-marble-church  | Marble Church  | normal   | true    | 15            | 55.6847  | 12.5895   |
| copenhagen-kastellet      | Kastellet      | normal   | true    | 20            | 55.6912  | 12.5937   |
| copenhagen-little-mermaid | Little Mermaid | must     | true    | 15            | 55.6929  | 12.5993   |
| copenhagen-reffen         | Reffen         | optional | true    | 35            | 55.6934  | 12.6106   |
| copenhagen-christiania    | Christiania    | must     | true    | 35            | 55.6736  | 12.5977   |

- Trip ID: `copenhagen`; time zone: `Europe/Copenhagen`.
- Trip start and end date: `2026-09-08`.
- Single day: `copenhagen-day-1`, date `2026-09-08`, title Copenhagen.
- Planned start: `10:00`; sightseeing hard end: `18:30`, both local time.
- Day plan contains only StopId references with orders 1 through 7 above.
- `copenhagenAirport` is a typed `PostDayDestination` with separately branded ID
  `copenhagen-airport`, navigation address `Copenhagen Airport`, and transit mode.
  This matches the frozen airport navigation target. No airport arrival time or
  travel duration was established, so both are omitted. Airport is absent from
  stops, day plans, sightseeing legs, and execution state.
- Optional stop notes, short names, and time constraints are omitted. The board's
  demonstration timed-stop alert does not establish a static appointment time.

### Prepared legs

| From           | To             | Mode    | Minutes | Prepared distance / instruction        |
| -------------- | -------------- | ------- | ------- | -------------------------------------- |
| Nyhavn         | Amalienborg    | walk    | 12      | 850 m                                  |
| Amalienborg    | Marble Church  | walk    | 5       | 350 m                                  |
| Marble Church  | Kastellet      | walk    | 12      | 900 m                                  |
| Kastellet      | Little Mermaid | walk    | 14      | 1100 m                                 |
| Little Mermaid | Reffen         | ferry   | 18      | Harbour Bus 992                        |
| Reffen         | Christiania    | transit | 19      | Transit + walk                         |
| Little Mermaid | Christiania    | transit | 37      | Transit + walk; prepared Reffen bypass |

The six adjacent leg inputs are prepared in the frozen itinerary. The bounded
37-minute bypass is explicit prepared data in the reference leg helper; only
that static record is encoded. No helper is imported, called, or reproduced.
Selecting legs, including the bypass, belongs to later execution work. No route
provider, geometry, unknown distance, first-stop inbound zero, or airport leg
was fabricated.

The only rule is `copenhagen-reffen-buffer-below-30`, with action
`recommend_skip` targeting `copenhagen-reffen`. Reffen retains its optional
priority separately from all stops' skip permission. The rule neither skips a
stop nor alters a plan.

## Validation invariants

- Nonblank identities; unique stop, day, leg, and rule IDs.
- Every day-plan, leg endpoint, and rule target references a trip-level Stop.
- At most one original placement per Stop across all plans, including duplicate
  occurrences within the same day. Errors identify the earlier reference path.
- Plan orders are unique within a day and nonnegative safe integers. Sparse
  values and unsorted plan arrays remain valid because `order` determines the
  sequence without requiring mutation.
- Days have valid calendar dates, fall within a valid trip date range, and appear
  in strictly increasing date order, with one execution day per date.
- Valid time zone and HH:mm local static time fields.
- Finite nonnegative durations, distances, and thresholds; coordinate bounds.
- Post-day destination raw IDs cannot collide with sightseeing Stop IDs or
  appear in sightseeing plan, leg, or rule references.
- Post-day navigation addresses are nonblank; coordinate targets are bounded.
- Optional durations remain optional; unknown duration has no numeric fallback.
  Unplanned stops and empty plans remain supported by the existing contract.

`validateTrip(trip)` accepts a statically typed `Trip`, not arbitrary untrusted
JSON. It returns a discriminated result with deterministic `{ code, path,
message }` errors. It performs no correction, mutation, projection, or execution.
The accepted `originalPlannedDayId()` implementation is unchanged. The existing
38 validator tests and validator implementation were preserved on continuation.

## Tests added

46 new tests (38 validator tests plus 8 Copenhagen tests) cover:

- canonical fixture validation;
- exact stable sightseeing identities, names, and unique placement;
- all seven `canSkip` values, independent priorities, and visit durations;
- resolved date, single day, local start, and hard deadline;
- trip-owned stops with deterministic StopId-only day plans;
- Airport post-day navigation data and absence from sightseeing/runtime data;
- the sole Reffen recommendation targeting the correct ID at exactly 30;
- all prepared leg endpoints, modes, durations, and known distances;
- duplicate stop, day, leg, and rule IDs;
- unknown day-plan references, both leg endpoints, and rule targets;
- duplicate order and duplicate original cross-day/same-day placements;
- invalid/nonfinite ordering, dates, time zones, durations, and coordinates;
- post-day raw identity collisions and planning/leg/rule misuse;
- valid multi-day data, sparse ordering, optional data, and unknown duration;
- deterministic actionable errors and input immutability.

Existing compile-only assertions also preserve the PostDayDestinationId boundary
for DayPlanItem, Current, StopExecution, and Do Now contracts.

## Verification

- `npm test` — PASS, 53 tests (7 existing and 46 new).
- `npm run typecheck` — PASS, including negative identity assertions.
- `npm run build` — PASS; `/` and `/design-board` remain present.
- `node_modules/.bin/oxlint data/trips/copenhagen.ts domain/trip/validate-trip.ts domain/trip/index.ts domain/__tests__/trip-validation.test.ts domain/__tests__/copenhagen-fixture.test.ts`
  — PASS, zero findings.
- `node_modules/.bin/oxfmt --check data/trips/copenhagen.ts domain/trip/validate-trip.ts domain/trip/index.ts domain/__tests__/trip-validation.test.ts domain/__tests__/copenhagen-fixture.test.ts package.json artifacts/rr-mvp-01/RouteRunner-RR-MVP-01-copenhagen-fixture-validation.md`
  — PASS.
- `npm run lint -- --format json` — FAIL; exactly 22 inherited diagnostics across
  14 files. JSON inventory confirms zero slice findings; all 14 diagnostic files
  are unchanged from `48ff8bb`.
- `git diff --check` — PASS.
- Final diff and production import review — PASS; only the seven intended slice
  files changed. Frozen app, components, design-reference, domain contracts,
  execution contracts, and original-planned-day helper are unchanged.

## Boundary review and carried findings

- Stops remain trip-level; DayPlanItem remains a StopId reference.
- No execution state was added to TripDay or the fixture.
- PostDayDestination identity remains distinct; Copenhagen Airport is not a Stop.
- Reffen rule is static data only, with no evaluator or transition.
- All encoded leg durations have prepared reference evidence.
- Duplicate original day placement is rejected.
- Production fixture imports only the production domain layer.
- No Astra frontend, visual components, styling, or design-board changes.
- RR-02A-AUD-001: PRESERVED. `app/page.tsx` still uses prototype state.
- Full lint debt: unchanged 22 diagnostics across 14 files.
- No previous slice artifacts were overwritten.
- Input blockers: resolved by Control Tower; no remaining implementation blocker.

## Explicit deferred work

All execution transitions, initial execution state creation, day/trip completion,
day switching, zero-work behavior, schedule health/projection, buffer calculation,
timed alerts, fallback evaluation and eligibility/acknowledgement, persistence,
location/GPS, navigation URL integration, routing providers/LegResolver, route
optimization, Rome production data, and production UI integration remain
outside this slice.

RR-MVP-01 IMPLEMENTATION COMPLETE — READY FOR CONTROL TOWER REVIEW
