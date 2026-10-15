# Batch 19: locked route (Plan A) — Other mode, Route optimization on, ROUTE order

Approved by the user 2026-10-15 ("lets go with, A"; "go as recommend, code it"). Release R1 1.0.6 after the tests.
User's words: "do a round of pick ups and drop offs that is optimized and the update feature doesnt update my route when
I am doing the contracts that I have, only if I accept more contracts should that change. the location is for
distance, but once planned - the route should not change unless I acccpet contracts."; "contracts are done with a
contract manager and can be accepted almost anywhere in game"; "an dropped or abanonded contract should grey out, so
the user is aware of what has happend". Haul mode is not touched. Switch off = ROUTE plain nearest-next as before.

## Behaviour (switch `otherRouteOptimize` on, listOrder 'route')

1. **Not planned:** ROUTE shows a live optimised PREVIEW (1.0.5 optimiser, NO pin/20% rule). Status "Not planned
   (preview) · press PLAN ROUTE when you're ready to fly"; overlay "ROUTE · not planned" + PLAN ROUTE button.
2. **PLAN ROUTE** (Next tab button and overlay button; the overlay sends OtherAction `{ type: 'planRoute', jobId: '' }`
   relayed to the main window, which alone writes jobs): position = the current origin (live/auto start, else STARTING
   AT); if the origin is a read older than 5 min, run a WHERE AM I read first (window.supercargo.otherWhereRun) and
   plan from its result (on failure plan from the old/typed start and say so). Plan = best of several improvement runs
   (nearest-next start + other starting orders, deterministic), up to 100 routed stops (above: nearest-next), every
   delivery after all its same-job same-item pickups, fewest jumps then metres. Saved in other-jobs.json `routePlan`,
   shared by both windows, survives restart. Stops at the same place in a row show as ONE visit
   ("Seraphim Station · pick up 2 · drop off 1"). Overlay card shows the next visit and "then: B · C" (next 2 visits).
3. **Flying:** order never changes on its own; live reads only update distances. Finished steps drop out (note
   "<place> done · next: <place>"). Contract abandoned / failed / step withdrawn / job removed: its stops stay in place,
   GREY, no number, label "<reason> HH:MM" (reason abandoned|failed|withdrawn|removed), not counted, never next; stay
   until RE-PLAN or route complete (note "J22 abandoned · 2 stops greyed out"). A stop that had no point at planning
   and gets one later is slotted in at the cheapest spot without moving others (note "<place> placed · now stop N").
4. **New contract after planning (accepted anywhere):** its open stops are inserted into the REMAINING route, from the
   current position (may go before the current next stop), cheapest insertion keeping precedence and keeping the other
   stops' relative order; tag NEW for 60 s; note "J25 added · pickup 1st, drop-off 6th · +38 Gm"; status adds
   "+N stops added (+X)". Stops whose position changed because of an insertion get MOVED for 60 s.
5. **Re-plan suggestion:** when the remaining planned route is >= 15% longer than a fresh plan from the current
   position, status adds "Added stops made the route N% longer than a fresh plan · RE-PLAN?" (suggest only).
6. **RE-PLAN:** same button (label RE-PLAN once planned): fresh plan of everything left from the current position,
   clears grey stops and tags, new plan time.
7. **Route complete:** no open planned stops left -> status "Route complete"; the next PLAN ROUTE starts fresh; new
   contracts after completion go back to preview (not planned).
8. **Feedback:** status line in both windows (lock icon 🔒 when planned: "🔒 Route planned 13:40 · 12 stops · 98.6 Gm ·
   saves 11.5 Gm"; overlay short "🔒 ROUTE · 7 of 12 left"); 4 s notes for every route event in both windows
   (from `routePlan.events`, newest 10 kept, shown when younger than 4 s); "Why here?" one line per row on the Next tab
   when the row is clicked ("After its pickup at <place> (Jxx)", "Closest next stop from <place> · <dist>", "Added
   after planning (Jxx) · cheapest spot · +<dist>", "No place yet · fix the tag to route it"); bottom line "N stops
   can't be routed (no place) · FIX" opening the first in the fix panel. Overlay: status + notes only. Every plan /
   slot-in / grey / re-plan logged (dlog + decide) and shown in diagnostics.
9. **Removed:** the 1.0.5 per-window pin (`routePin.ts`) and the 20% rule; old jobs files without `routePlan` start
   "Not planned"; one route at a time; the plan stays saved while in Haul mode.

## Shared contract

- `src/other/otherRoutePlan.ts` (new, pure; owner core):
  ```ts
  export type GreyReason = 'abandoned' | 'failed' | 'withdrawn' | 'removed'
  export interface RouteEvent { at: string; kind: 'planned'|'replanned'|'done'|'added'|'grey'|'placed'|'complete'|'position'; text: string }
  export interface RoutePlanDoc {
    v: 1; at: string                       // plan time (ISO)
    startLabel: string; startPoint?: { x: number; y: number; z: number } | null
    order: string[]                        // stopKey(job.id, step.id) in planned order (open + grey kept; done removed)
    nearestMeters: number | null; plannedMeters: number | null; plannedJumps: number
    grey: { key: string; reason: GreyReason; at: string; label: string }[]
    tags: { key: string; tag: 'NEW' | 'MOVED'; at: string }[]
    added: { key: string; at: string; addMeters: number | null; jobRef: string }[]
    events: RouteEvent[]                    // newest last, max 10
    complete?: string                       // ISO when completed
  }
  export function planRoute(rows, start, locations, opts?): { order: string[]; nearestMeters; plannedMeters; plannedJumps }
  export function slotIn(plan, rows, current, locations): { plan: RoutePlanDoc; inserted: {key, index, addMeters}[] }
  export function reconcile(plan, jobs, rows, now): { plan; changed: boolean; events: RouteEvent[] }  // done -> remove,
     //  dropped -> grey, new open keys -> needs slotIn (returned list), unplaced->placed detection, complete
  export function routeView(plan | null, rows, opts: { now, locations, start, preview: boolean }): RouteView
  export interface RouteView { state: 'preview'|'planned'|'complete'; rows: ViewRow[]; status: {...}; notes: RouteEvent[]; replanPct: number|null; unroutable: number }
  export interface ViewRow { key; row: OpenStopRow | null; number: number | null; grey?: { reason; at }; tag?: 'NEW'|'MOVED'; why: string; visitId: string }
  ```
  (exact field names may be refined by core; ui/state import only from this file and otherNext.ts.)
- `src/other/otherJob.ts`: `OtherJobsDoc.routePlan?: RoutePlanDoc | null` (owner state).
- `src/other/otherActions.ts`: `{ type: 'planRoute'; jobId: string }` (jobId '' ; owner state).
- `src/other/otherNext.ts` (owner core): remove `routePin` option and pin logic (keep `stopKey`, `optimiseRoute`, helpers;
  export what core/state need).

## Owners

| Agent | Files |
|---|---|
| core | src/other/otherRoutePlan.ts (new), src/other/otherNext.ts, test/replay/route_plan_checks.mjs (new), next_order.mjs / route_bench_checks.mjs (pin parts) |
| state | src/other/renderer/state/otherJobs.ts, src/other/otherJob.ts, src/other/otherActions.ts, src/other/main/jobs.ts (only if routePlan needs validation) |
| next-ui | src/other/renderer/pages/NextPage.tsx, delete src/other/renderer/state/routePin.ts (after overlay and diag drop their imports) |
| overlay-ui | src/other/renderer/components/OtherOverlay.tsx |
| diag | src/other/renderer/state/otherDiag.ts |
| e2e | test/replay/replay.mjs |
| docs | STANDALONE, DECISIONS, SYSTEM-MAP, TODO, contracts README, release-notes/1.0.6.md (public wording) |
