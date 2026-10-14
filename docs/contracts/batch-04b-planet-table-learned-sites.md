<!-- Copy of the batch contract the lead gave the agents (CONTRACT5.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 4b contract: local planet table + learned generic places (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features. Background: CONTRACT.md..CONTRACT4.md (batch 4 is being built in parallel:
agents markers (otherMarkers.ts, otherJobs.ts), next (otherNext.ts, OtherOverlay.tsx, NextPage.tsx), e2e-docs (replay.mjs, docs)).
Rules: edit ONLY your files; no commits; no player names; activity log lines; `npm run typecheck` before finishing.

## What
Planet table, saved locally (userData/other-bodies.json), survives restarts:
  BodyInfo { name; system; type ('Planet'|'Moon'|...); parent?: string; centre: {x,y,z};
             radiusM?: number (exact, from the r_DisplayInfo panel "Radius:"); radiusEstM?: number (median distance of the
             body's roster places from its centre); radiusSource: 'panel' | 'estimate' | null; seen: number; lastSeen?: string }
  - Bodies come from the roster: entries that some place names as its `body`, plus Location entries whose name equals a body
    (centre = that entry). Starmap types/parents: if the roster doesn't carry type/parent, leave them undefined.
  - Exact radius is recorded in main after every WHERE AM I read whose DisplayInfo has body + radiusM (sanity: 50 km–10,000 km);
    the panel radius wins over the estimate. seen/lastSeen bump on each record.
Learned generic places (diagnostics + label hint only): { name (generic, e.g. "Security Compound"), near (roster place),
  nearMeters, body?, system?, point {x,y,z}, seen, lastSeen } — recorded when a marker resolves a generic step place to a point
  near a known place (batch 4 F2 "near"). Keyed by name+near. Max 200 entries (drop oldest).

## Interfaces (fixed names)
- NEW src/other/otherBodies.ts (pure): BodyInfo, LearnedPlace, BodiesDoc { bodies: Record<string, BodyInfo>; learned: LearnedPlace[] },
  buildBodies(locations, saved?: BodiesDoc): Record<string, BodyInfo>; bodyRadiusFromTable(table, name): number | null
  (exact first, then estimate); recordPanelRadius(doc, body, system, radiusM, at): BodiesDoc; recordLearned(doc, entry, at): BodiesDoc.
- NEW src/other/main/bodies.ts: load/save (atomic write), getBodies(), onWhereRead(result) hook (records radius),
  IPC: otherBodiesGet 'otherBodies:get' (invoke -> BodiesDoc with bodies built from the current roster + saved),
  otherLearnedPlace 'otherBodies:learned' (send, renderer -> main, LearnedPlace minus seen), evtOtherBodies 'evt:other:bodies'
  (broadcast BodiesDoc on change). Diagnostics: add a 'BODIES' key to the setOtherDiagSource sections (table + learned).
- preload: otherBodiesGet(), otherLearnedPlace(p), onOtherBodies(cb).
- Renderer store NEW src/other/renderer/state/otherBodiesStore.ts: loads on start, subscribes, `useBodies()` hook +
  `bodiesTable()` getter for non-React code.
- Wiring (agent bodies-use, AFTER batch 4's markers/next finish): otherMarkers.bodyRadius(body, locations) uses bodiesTable()
  first (keep the estimate fallback); otherWhere.ts replaces its hard-coded radii with an optional lookup param
  (resolveDisplayInfo(info, locations, at, opts?: { bodyRadius?: (name) => number | null })), whereAmI passes the main table;
  otherGeo surface arc uses the table radius when both points are on that body; otherJobs reports learned places
  (otherLearnedPlace) when a marker step gets a `near` (batch 4 F2); diag_checks/next_order tests updated.

## Agents
- bodies-core (now): src/other/otherBodies.ts, src/other/main/bodies.ts, src/shared/channels.ts (Other block), src/preload/index.ts
  (Other lines), src/other/main/register.ts, src/other/main/whereAmI.ts (call onWhereRead hook only),
  src/other/renderer/state/otherBodiesStore.ts, NEW test/replay/bodies_checks.mjs (pure tests: build from other-positions.json —
  Hurston estimate ≈1000 km, Lyria ≈224 km; panel radius wins; learned cap; sanity limits).
- bodies-use (later): src/other/otherMarkers.ts, src/other/otherWhere.ts, src/other/otherGeo.ts, src/other/renderer/state/otherJobs.ts,
  test updates in where_checks.mjs / marker_checks.mjs / diag_checks.mjs.
