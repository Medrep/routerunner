# RouteRunner RR-MVP-00 Engineering Foundation

## Repository

- Baseline commit: `f85d9df` (`RR-02A: hand off frozen Astra frontend`)
- Implementation commit: the commit containing this report, titled
  `RR-MVP-00: establish engineering foundation`
- Branch: `main`

## Files added or changed

- `domain/trip/types.ts`
- `domain/trip/original-planned-day.ts`
- `domain/trip/index.ts`
- `domain/execution/types.ts`
- `domain/execution/index.ts`
- `domain/index.ts`
- `domain/__tests__/domain-contracts.test.ts`
- `package.json`
- `tsconfig.json`
- `artifacts/rr-mvp-00/RouteRunner-RR-MVP-00-engineering-foundation.md`

## Canonical domain paths

- Static trip contracts: `domain/trip/`
- Trip-level execution contracts: `domain/execution/`
- Public production-domain exports: `domain/index.ts`

## Invariants established

- Stops are trip-level entities with stable IDs.
- Days contain ordered stop-ID references rather than owned Stop objects.
- Static day plans remain independent from trip-level execution state.
- `currentStopId` is the sole Current authority.
- `StopExecutionStatus` contains only `pending`, `completed`, and `skipped`.
- `completedOnDayId` can differ from the day derived from the static plan.
- `originalPlannedDayId` derives immutable planning ownership from
  `TripDay.plan`.
- Post-day destinations are static day navigation data, not sightseeing stops.
- Known and unknown travel durations are distinct union variants; unknown has
  no numeric fallback.
- Do Now queue entries preserve their prior scheduled-day context.
- Completed day IDs live on trip execution state and have conceptual set
  semantics; days do not own execution state.
- No viewed-day UI state is part of the execution contracts.

## Tests added

`domain/__tests__/domain-contracts.test.ts` covers:

- multi-day trip construction;
- trip-owned stops and stop-ID day plans;
- Day 2 original-plan derivation;
- completion on Day 1 without mutation of the Day 2 plan;
- absence of a StopExecution Current field/status;
- sole trip-level `currentStopId` authority;
- separation of post-day destinations from sightseeing execution;
- explicit unknown duration;
- Do Now return-day context; and
- trip-level completed-day representation.

## Verification

- `npm test` — PASS (7 tests)
- `npm run typecheck` — PASS
- `npx oxlint domain/trip domain/execution domain/index.ts` — PASS
- `npx oxfmt --check package.json tsconfig.json domain` — PASS
- `npm run build` — PASS; `/` and `/design-board` remain build routes
- `npm run lint` — FAIL on 21 pre-existing findings outside RR-MVP-00 files
- `git diff --check` — PASS

The full lint findings remain in pre-existing files and include JSX
accessibility rules in UI components, React compiler effect-state findings,
the Next.js image finding in `app/page.tsx`, and TypeScript template-expression
findings in `components/ui/chart.tsx`. No RR-MVP-00 domain file was reported.

## Frontend preservation and carried finding

The frozen Astra application files and styling were not changed.
`/design-board` and `design-reference/` remain present.

RR-02A-AUD-001 is preserved for RR-MVP-02. `app/page.tsx` continues to import
prototype state and transitions from
`design-reference/copenhagen-fixtures.ts`; RR-MVP-00 neither hides nor expands
that seam. No production domain file imports `design-reference/`.

## Explicit deferred work

- RR-MVP-01: Copenhagen production fixture and fixture validation.
- RR-MVP-02: execution transitions and replacement of the prototype-state
  production seam.
- RR-MVP-04: schedule projection, deadlines, time constraints, and rule
  evaluation.
- RR-MVP-05: persistence and integration work owned by that slice.
- RR-MVP-06: location, routing, and navigation work owned by that slice.
- Rome-specific later slices: Rome UI/data, day switching, and multi-day
  lifecycle behavior.

No backend, authentication, deployment-platform change, analytics, native app,
persistence, route optimization, state machine, or later-slice behavior was
introduced.
