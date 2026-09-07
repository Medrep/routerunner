# RouteRunner RR-MVP-02 — Core Execution

## Repository baseline

- Baseline commit: `848e0ac064717d8c05461f32611348fd8215cb25`
- Original RR-MVP-02 implementation commit:
  `59279a7242ff5fc6d6632dea6cc84bef3e4f8110`

## Production execution layer

- Initializer: `domain/execution/create-execution-state.ts`
- Core transitions and derivation helpers: `domain/execution/transitions.ts`
- Public exports: `domain/execution/index.ts`

`createInitialTripExecutionState(trip, now)` creates one pending execution per
sightseeing Stop, derives its original scheduled day, leaves pre-start Current
and execution day absent, uses the supplied timestamp, and does not create
execution state for a post-day destination.

Implemented transitions:

- Start Day
- Done / complete Current
- Skip Current, gated only by `canSkip`
- Save Current for Later by retaining `pending` and setting `scheduledDayId` to
  `null`

Ordinary invalid transitions return a typed discriminated result:
`{ ok: true, state } | { ok: false, error: { code, message } }`. Inputs and
nested execution records are not mutated. Advancement uses the first eligible
pending Stop in the active immutable day plan according to ascending numeric
`DayPlanItem.order`; it does not promote Do Now work, cross days, or infer
completion.

The production execution layer derives a sorted copy of `TripDay.plan` for
Start, shared advancement, and presentation Next. Raw `TripDay.plan` array
position is not authoritative, sparse order values are supported, and the
canonical source array is never mutated.

## Production page integration

`app/page.tsx` now initializes React state from the production `copenhagenTrip`
and the production initializer. All exposed Start Day, Done, Skip, and Save for
Later actions call the production transition functions. Itinerary and map
statuses are derived from `Trip + TripExecutionState`; `currentStopId` remains
the only Current authority.

The production page imports no execution fixtures, snapshots, transitions, or
schedule calculations from `design-reference/`. Dynamic schedule projection is
shown as unavailable. External Maps, live routing, and GPS are not simulated.
The existing `/design-board` page and `design-reference/` sources are unchanged.

RR-02A-AUD-001 status: **RESOLVED**.

## Tests and verification

Added `domain/__tests__/execution-transitions.test.ts` with 14 focused test
cases covering:

- initialization, post-day exclusion, null scheduling, and fixture immutability;
- Start Day success, explicit unknown inbound duration, invalid starts, and
  input immutability;
- Done timestamps, active-day completion provenance, deterministic advancement,
  final-Current clearing, static-plan preservation, and no inferred day
  completion;
- Skip permission, separation of priority from `canSkip`, lack of completion
  history, advancement, and failed-transition immutability;
- Save for Later pending/unscheduled semantics, original-plan derivation,
  advancement, final-Current clearing, and no inferred completion;
- preservation of `doNowQueue`, `completedDayIds`, and
  `ruleAcknowledgements`.
- physically unsorted valid plans for Start, Done, Skip, Save for Later, and
  presentation Next;
- sparse numeric plan order and ordered advancement across completed, skipped,
  For-Later, and another-day entries without source-plan mutation.

RR-MVP-02-AUD-001 was corrected after independent review: production execution
and presentation sequence now consistently use numeric `DayPlanItem.order`.

Verification results before commit:

- `npm test`: PASS — 67 tests, 67 passed.
- `npm run typecheck`: PASS.
- `npm run build`: PASS — output includes `/` and `/design-board`.
- focused Oxlint on correction-touched code: FAIL only on the accepted
  pre-existing `next(no-img-element)` finding retained in the production page.
  The correction did not touch the shared map containing the other two
  documented focused findings. No RR-MVP-02 correction lint finding was added.
- `npx oxfmt --check` on all changed code/test files: PASS.
- full `npm run lint`: FAIL — the accepted 22 diagnostics remain across
  legacy/shared files; RR-MVP-02 adds none.
- `git diff --check`: PASS.
- local HTTP smoke check: `/` returned 200 and `/design-board` returned 200.

## Temporary limitation and deferred functionality

Execution state is intentionally in-memory only and resets on reload.

Deferred:

- Do Now enqueue/FIFO/cancel and Already Visited;
- End Day, `DAY_COMPLETE`, reopening, `TRIP_COMPLETE`, and multi-day lifecycle;
- persistence;
- schedule projection, schedule health, and Reffen rule evaluation;
- routing, LegResolver, GPS, and external Maps integration;
- Rome production data and behavior.
