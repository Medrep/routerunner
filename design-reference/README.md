# RouteRunner design reference

This directory contains frozen demo data and prototype state helpers used to render the Astra frontend without a production domain engine.

`copenhagen-fixtures.ts` supplies the reference Copenhagen itinerary, prepared scenario snapshots, and the small in-memory transition helpers used by the interactive prototype. Engineering should replace this boundary with persisted RouteRunner domain state, routing results, schedule projections, and location input. The reusable map renderer receives presentation data through props and does not import this fixture module.

The `/design-board` route remains the 27-state visual regression and review harness. Production-facing modules do not import the design board.
