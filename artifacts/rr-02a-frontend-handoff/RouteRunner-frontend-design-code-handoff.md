# RR-02A Frontend Design Code Handoff

Source design commit: `f8f42b8`

The frozen Astra frontend has been copied into the canonical RouteRunner repository and retained as working source. This handoff only separates reusable presentation code from frozen demo fixtures; it does not change the accepted design semantics or implement the production execution engine.

## Reused production-capable frontend

- `app/page.tsx` — complete interactive Astra execution shell: trip context, schedule presentation, map, Current/Next, full itinerary, decisions, details, Full Map, completion, and airport action.
- `components/routerunner/route-map.tsx` — reusable schematic map shell and marker renderer. Stops and route state enter through typed props; the component does not import the design board or Copenhagen fixture.
- `app/globals.css` — frozen Astra tokens, typography, spacing, layout, component states, sheets, map presentation, and responsive rules.
- `app/layout.tsx` — application shell, metadata, and global-style entry point.
- `components/ui/` — existing local primitives used by the Astra shell, including Sheet, Dialog, and Select.
- `public/favicon.svg` — RouteRunner application mark.

## Prototype-only and design-reference code

- `app/design-board/page.tsx` — development/reference-only 27-state review harness. It remains available at `/design-board` for visual regression and design review.
- `design-reference/copenhagen-fixtures.ts` — Copenhagen itinerary, demo scenario snapshots, and temporary in-memory transition helpers.
- `design-reference/README.md` — boundary and replacement guidance for implementation agents.
- `public/design-board-iphone17.html` — frozen standalone review-board export.
- `public/export-iphone17.html` — frozen device-export helper/reference.

## Hard-coded demo/state fixtures

- `design-reference/copenhagen-fixtures.ts` — stop content, coordinates, durations, transit labels, hard-stop scenario state, buffer inputs, skip/save flags, and prototype transitions. Real persisted trip/day/stop state, execution events, routing results, schedule projections, and location input will replace this module.
- `app/design-board/page.tsx` — 27 fixed Copenhagen and Rome review states. These fixtures remain a design reference and are not a production state source.
- `app/page.tsx` — the scenario selector and local React state connect the frozen UI to the demo fixture boundary. A later implementation will connect the same presentation to the production execution engine.

## Known frontend limitations

- The production entry route still runs as an in-memory interactive prototype and resets on reload.
- The reference map is schematic; it has no live GPS, tiles, routing service, or offline route cache.
- Navigate opens a Google Maps URL directly and has no native-app handoff abstraction.
- Most execution-shell sections remain grouped in `app/page.tsx`; only the map has been extracted to a typed reusable RouteRunner component.
- Full/source lint reports pre-existing findings in the local UI component library and preserved prototype map/image markup. The new fixture boundary and design-board import changes pass focused lint.

## Verification

- Frozen source provenance: `f8f42b8`.
- Production code has no import dependency on `app/design-board/page.tsx`.
- The design-board route remains available.
- `npm run build`: PASS.
- Formatter for all touched frontend files: PASS.
- Focused lint for `design-reference/copenhagen-fixtures.ts` and `app/design-board/page.tsx`: PASS.
- Preserved page/map lint: three known findings (`svg role=img`, SVG marker `role=button`, and prototype `<img>` usage); reported without suppression.
- Frozen design semantics changed: none.
