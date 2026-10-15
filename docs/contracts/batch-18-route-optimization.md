# Batch 18: Route optimization switch (Other mode) and FROM START pickup order

Approved by the user 2026-10-15 ("ok, code it, then release it based on your recommendatations"). User's words:
"yeah, lets change this: … FROM START … can put a delivery above its own pickup"; "only in other modes. I dont care
about haul mode … in other modes we handle small items, so i mosty care about route order"; "that sounds like a mode
switch we need to put into options. Say Route Optimization Mode? That way we can test it out first? So default is
what exists, and the switch is what we are planning." Recommendations taken: next stop may change mid-flight only when
the new plan is at least 20% shorter; "saves N km" shown whenever the switch is on. Haul mode is not touched.

## Behaviour

1. **FROM START (always, not behind the switch):** an open delivery whose same-job, same-item pickup is still open is
   listed directly after that pickup; everything else keeps its distance order. Overlay and Next use the same list.
2. **Setting `otherRouteOptimize`** (boolean, default **false**), Settings → OTHER MODE → Distances & Route, label
   "Route optimization", hint "Shortens the ROUTE order. Off = nearest stop next, as before."
   - Off: ROUTE exactly as today (greedy nearest-next, pickups before deliveries).
   - On: ROUTE = the nearest-next trip, then improved by local search (move one stop elsewhere / reverse a stretch,
     keep a change only if the whole trip gets better), never putting a delivery before its pickup. A trip compares as
     fewer total jumps first, then fewer total metres (the same `compareTravel` order). Stops at the same place stay
     together. Deterministic (same input -> same order). Stops without a point stay at the bottom as today.
3. **Steady next stop (switch on, start from a live read / auto start):** the stop that was first in the previous plan
   stays first while it is still open, unless the best plan without that pin is at least 20% shorter in metres (or has
   fewer jumps). Pin memory is per window, in the renderer (`src/other/renderer/state/routePin.ts`), cleared when that
   stop is done/withdrawn or the order mode changes.
4. **Display (switch on):** the Next tab order line reads "Route (optimised) from <start>[ (auto)] · saves N km vs
   nearest-next" (N via the existing distance formatter; omit "saves" when 0 or unknown); the overlay order hint shows
   "ROUTE (OPT)". ROUTE total and legs show the optimised numbers.
5. **Diagnostics:** the Other route/order section records, when the switch is on, both totals (nearest-next and
   optimised, metres and jumps), whether a pin was kept or dropped, and the stop count.

## Shared contract

- `src/other/workMode.ts`: `otherRouteOptimize?: boolean` in the Other settings type, default `false` in
  `OTHER_SETTING_DEFAULTS` (owner: settings).
- `src/other/otherNext.ts` (owner: route):
  - `ListOpenStopsOpts` gains `routeOptimize?: boolean` and `routePin?: string` (a stop key, see below).
  - `export function stopKey(row: { job: { id: string }, step: { id: string } }): string` -> `${job.id}:${step.id}`.
  - `export interface RouteInfo { optimised: boolean; nearestMeters: number | null; nearestJumps: number;
    optimisedMeters: number | null; optimisedJumps: number; pin: 'kept' | 'dropped' | 'none'; stops: number }`
  - `export function listOpenStopsWithRoute(jobs, startLocation, locations, opts): { rows: OpenStopRow[]; route:
    RouteInfo | null }` (route null unless listOrder 'route' and routeOptimize on); `listOpenStops` keeps its signature
    and returns `.rows`.
  - pure helpers exported for tests: `pickupsBeforeDeliveries(rows)`, `improveRoute(...)`.
- Renderer (owner: ui): `src/other/renderer/state/routePin.ts` (`getRoutePin(windowScope)`, `noteRouteFirst(key)`,
  `clearRoutePin()`), NextPage.tsx order line + savings, OtherOverlay.tsx hint + pin use, otherDiag.ts route info.

## Owners

| Agent | Files |
|---|---|
| route | src/other/otherNext.ts, test/replay/next_order.mjs |
| bench | test/replay/route_bench_checks.mjs (new): real job sets (place names only, from the user's exports) — optimised never longer than nearest-next, never a delivery before its pickup, report savings |
| ui | src/other/renderer/pages/NextPage.tsx, src/other/renderer/components/OtherOverlay.tsx, src/other/renderer/state/routePin.ts (new), src/other/renderer/state/otherDiag.ts |
| settings | src/other/workMode.ts, src/other/renderer/OtherSettingsPage.tsx |
| e2e | test/replay/replay.mjs |
| docs | STANDALONE, DECISIONS, SYSTEM-MAP, TODO, contracts README, release-notes/1.0.5.md (public wording) |
