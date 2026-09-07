# RouteRunner RR-MVP-05 — Local Execution Persistence

## Baseline and implementation

- Repository: `/Users/alexkucheruk/Projects/RouteRunner/`
- Branch: `main`
- Baseline commit: `fa9212dd98027351fca33d5eb9de860ca4afdf25`
- Implementation commit: this bounded commit, `RR-MVP-05: persist local execution state` (the final hash is recorded in the closing implementation report)
- Baseline working tree: clean

## Persistence design

Production persistence is implemented in `domain/execution/persistence.ts` and
exported through `domain/execution/index.ts` and `domain/index.ts`. The
production page integration is in `app/page.tsx`. Focused coverage is in
`domain/__tests__/execution-persistence.test.ts`.

- Storage mechanism: browser `localStorage`
- Key format: `routerunner:execution:<tripId>`
- Current Copenhagen key: `routerunner:execution:copenhagen`
- Envelope schema version: `1`
- Envelope fields: `version`, `tripId`, `savedAt`, and `state`
- `savedAt`: the accepted execution state's ISO `lastUpdatedAt`, so saving an
  unchanged accepted state does not fabricate a newer persistence timestamp
- Public operations: `loadExecutionState`, `saveExecutionState`, and
  `clearExecutionState`

Browser storage access is isolated from the pure domain transitions. No
`window` or `localStorage` access occurs at module evaluation. The default
storage lookup occurs only when an operation is called and returns a bounded
`unavailable` result outside the browser or when the storage getter is blocked.

## Restore validation and fallback

Parsed browser data is treated as untrusted. Restoration accepts only schema
version 1 for the requested trip and reconstructs `TripExecutionState` from
canonical stop/day identities in the supplied production `Trip`. Runtime brand
metadata is not serialized. Validated raw stop strings are mapped back to the
canonical branded `StopId` values from the trip fixture.

The validator rejects:

- malformed JSON or a non-object envelope;
- unsupported versions, invalid `savedAt`, or envelope/state trip mismatch;
- unknown, extra, or missing sightseeing `StopExecution` identities;
- a post-day destination represented as sightseeing execution state;
- invalid stop status or scheduled/completed day references;
- unknown Current or inbound-travel stop references;
- unknown execution day;
- invalid Do Now stop or return-day references;
- unknown or duplicate completed day IDs;
- invalid duration variants and timestamp/value shapes;
- malformed rule acknowledgement records.

Invalid data is never partially merged. `restoreOrCreateExecutionState` returns
a fresh state from the accepted `createInitialTripExecutionState` initializer
for absent, invalid, incompatible, or unavailable storage. On the production
page, the subsequent authoritative-state save replaces an invalid entry with
the fresh state. An active execution day with no Current is valid and restores
without automatic day completion.

## Storage failures

Read, write, and remove exceptions are caught and represented by deterministic
`unavailable` results carrying the operation and reason. Storage failure never
throws through the React event flow. A failed write does not mutate or discard
the accepted in-memory execution state. Failed transitions do not change React
execution state, so the persistence effect does not write a new envelope or
advance `savedAt`.

## UI hydration and saving

`app/page.tsx` uses a server-consistent hydration snapshot boundary. Server
rendering and the first hydration render show a small Astra-compatible
“Restoring / Loading local progress” state. Only after hydration does the
execution component mount and synchronously choose restored or fresh execution
state. This avoids a visible fresh-pre-start-to-Current semantic flash.

A single React effect saves whenever the authoritative `TripExecutionState`
reference changes. Successful Start Day, Done, Skip, and Save for Later
transitions update that state and are persisted. Transition functions remain
browser-independent. The production page has no `design-reference` dependency,
and `/design-board` is unchanged.

## Automated coverage

The new focused test file contains 35 passing tests/subtests. It covers:

- deterministic trip-specific key and versioned envelope metadata;
- fresh, Start Day, Done, Skip, and Save for Later round trips;
- branded `StopId` restoration and explicit unknown-duration preservation;
- active-day/no-Current preservation without `DAY_COMPLETE`;
- populated `doNowQueue`, `completedDayIds`, and `ruleAcknowledgements`;
- malformed JSON and all required incompatible stop/day/status/timestamp cases;
- explicit post-day destination rejection;
- empty/invalid fallback through the accepted initializer;
- read/write/remove exceptions and trip-scoped clear behavior;
- failed-transition envelope stability;
- production page restore/save wiring, absence of `design-reference` and direct
  `localStorage` access, plus server-side safe persistence access.

Full suite result: 102 tests passed, 0 failed.

## Browser smoke evidence

Performed on the local production route in Chrome against `vinext dev`:

1. Opened `/` and observed fresh `FIRST STOP / Not started`, Nyhavn, and Start Day.
2. Selected Start Day and observed `NOW / Day active`, Nyhavn Current, and no completed stops.
3. Reloaded and observed Nyhavn still Current with 0 of 7 visited.
4. Selected Done and observed Amalienborg Current plus Nyhavn Visited.
5. Reloaded and observed Amalienborg still Current plus Nyhavn still Visited, 1 of 7.

The browser console contained only a hydration warning whose diff identified
Grammarly-injected `data-new-gr-c-s-check-loaded` and `data-gr-ext-installed`
attributes on `<body>`. No RouteRunner runtime error was observed.

## Build and quality

- `npm test`: PASS — 102 tests, 0 failed
- `npm run typecheck`: PASS
- `npm run build`: PASS — output includes `/` and `/design-board`
- Focused Oxlint on all changed TypeScript/TSX files: one inherited diagnostic
  in `app/page.tsx`, `next(no-img-element)` for the accepted Kastellet image;
  no RR-MVP-05 diagnostic
- Format check: PASS
- Full repository Oxlint: expected FAIL — 22 inherited diagnostics across 14
  files; the count is unchanged from baseline
- `git diff --check`: PASS

## Local-only limitation

Execution progress is local to this browser and device. There is no account
backup, cloud storage, or cross-device synchronization. Reloading or reopening
the page in the same browser restores progress while that site's browser data
remains available. Clearing browser site data removes progress.

## Explicitly deferred

- Do Now queue behavior, promotion, cancellation, and FIFO execution
- Already Visited, End Day, `DAY_COMPLETE`, and `TRIP_COMPLETE`
- schedule projection, ETA, buffer, and schedule health
- rule evaluation and Keep It acknowledgement behavior
- routing, GPS, live location, LegResolver, and external Maps
- Rome, next-day switching, leftovers, and multi-day lifecycle behavior
- backend, authentication, accounts, cloud backup, and multi-device sync
- push notifications
