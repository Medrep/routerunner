# RouteRunner RR-MVP-06 — Foreground Location and Navigation

## Repository and implementation

- Repository: `/Users/alexkucheruk/Projects/RouteRunner`
- Branch: `main`
- Baseline commit: `e1c209c18656d0460e0e58d0c584d96422bcd8e4`
- Implementation commit: the bounded commit containing this artifact; its full hash is recorded in the closing implementation report.

## Mapbox integration

- Production renderer: `components/routerunner/route-map.tsx`
- Pure production view derivation: `domain/map/route-map-view.ts`
- Global package CSS: `app/layout.tsx`
- RouteRunner styling: `app/globals.css`
- Minimal renderer dependency: `mapbox-gl`
- Environment contract: `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
- Safe example: `.env.example`; no real token is committed.

Mapbox is presentation only. It supplies the basemap, projection, pan, zoom,
and rendering surface for RouteRunner-owned overlays. The implementation calls
no Mapbox Directions, Matrix, Navigation, Search, geocoder, OSRM, Google
Directions, or Google Routes API.

Mapbox is dynamically imported only after the client container mounts. Each
component owns one map instance, removes all RouteRunner markers, removes the
user marker, and calls `map.remove()` on cleanup. Missing token and runtime map
failure are bounded map-presentation states; execution, itinerary, persistence,
Current, Next, and Google Maps navigation remain usable.

The frozen `/design-board` remains on the isolated schematic reference renderer
at `components/routerunner/design-route-map.tsx` and requires no token.

## Foreground location

- Explicit model/controller: `domain/location/foreground-location.ts`
- Browser hook: `hooks/use-foreground-location.ts`
- Production composition: `app/page.tsx`

The transient state model is `inactive`, `locating`, `available`, `denied`,
`unavailable`, `timeout`, or `error`. Available coordinates retain latitude,
longitude, accuracy, and observation timestamp. The controller maps browser
errors deterministically and never creates substitute coordinates.

Tracking starts only when an execution day exists and the page is visible.
Visibility becoming hidden clears the watch; becoming visible restarts it while
execution remains active. Deactivation and unmount also clear the watch. There
is no background tracking, service worker location, geofence, distance
threshold, arrival state, or automatic execution transition.

Location is not part of `TripExecutionState` and is never passed to persistence.
Reload restores execution independently and creates a new foreground watch.

## Map execution semantics

Production markers are keyed by stable `StopId` and derived from the immutable
ordered day plan. `DayPlanItem.order` is authoritative even when the physical
plan or Stop arrays are unsorted. Current comes only from
`TripExecutionState.currentStopId`; Next comes from the accepted ordered
eligibility helper. Completed, skipped, and For Later come from
`StopExecution`. The user marker has a separate blue presentation and no Stop
identity.

The canonical Copenhagen legs contain modes and endpoints but no accepted path
geometry. Because the frozen accepted map already defines straight connections
as schematic, production renders endpoint connectors explicitly captioned
“Prepared schematic connections · not live routing.” Walking, transit, and
ferry retain distinct RouteRunner-owned line styles. The prepared Reffen bypass
is not selected or evaluated in this slice. If no renderable prepared legs are
available, route presentation reports unavailable independently of GPS.

The earlier production Copenhagen/Reffen/index concern is removed. Production
map and stop-detail semantics no longer contain Reffen names, magic marker
indices, or physical Stop-array position authority. Index-specific code remains
only inside the frozen non-production design-reference renderer.

## Google Maps external navigation

- Pure URL/current-target logic: `domain/navigation/google-maps.ts`
- Explicit browser side effects and anchors: `app/page.tsx`

Google Maps is not embedded and needs no API key. The URL form is
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`.
Destination coordinates come only from the canonical Current sightseeing Stop.
No Current means no ordinary Navigate. Next, viewed future details, GPS, and the
post-day Airport are never fallbacks.

An unambiguous prepared inbound walking leg adds `travelmode=walking`; transit
adds `travelmode=transit`; ferry maps to transit. Unknown, initial, `other`, or
ambiguous inbound travel omits the parameter.

Start & Navigate calls the accepted Start Day transition, persists through the
RR-MVP-05 orchestration, then synchronously assigns the resulting Current URL
inside the click handler. Fresh Copenhagen therefore establishes Nyhavn and
targets Nyhavn. A rejected Start neither saves nor navigates. A failed write
does not roll back the accepted in-memory state and still permits the resulting
Current navigation. Ordinary Start Day shares the same transition/persistence
path but performs no external navigation.

## Verification

- `npm test`: PASS, 142 total tests, 19 new RR-MVP-06 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; `/` and `/design-board` were emitted.
- Focused lint: new RR-MVP-06 code clean; three inherited findings surfaced in
  changed paths (two frozen schematic accessibility-rule findings and the known
  `app/page.tsx` image finding).
- Format check: PASS.
- Full repository lint: expected inherited failure, exactly 22 diagnostics
  across the accepted repository surface; no new RR-MVP-06 diagnostic.
- `git diff --check`: PASS.

Browser smoke loaded production `/`, restored accepted local execution with
Amalienborg Current, showed the exact Current-only Google Maps coordinate URL,
and kept execution usable in the explicit missing-token map state. The frozen
27-state `/design-board` also loaded successfully. A real Mapbox basemap,
positive GPS movement, and independently controlled permission-denied browser
scenario were not reproduced because no local Mapbox token was configured and
the available browser surface did not provide isolated permission control.
Their surrounding boundaries are covered by deterministic tests without a real
token.

## Deferred functionality

- Advanced execution transitions, End Day, and completion lifecycle
- Schedule projection, ETA, buffer, health, and Reffen rule evaluation
- Live in-app routing and route optimization
- Background GPS, arrival detection, and geofencing
- Rome and multi-day execution lifecycle
- Post-trip Airport navigation
- Backend, cloud/account sync, and navigation-provider preferences
