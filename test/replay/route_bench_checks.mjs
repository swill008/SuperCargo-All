// Route optimization bench (batch 18): real job sets (place + item text from the user's exports) and synthetic
// 10-contract Stanton sets, run through listOpenStopsWithRoute with the switch off (nearest-next) and on.
// Checks: optimised never longer (jumps, then metres); no delivery before its pickup; same place stays together;
// deterministic; switch off = today's order; < 200 ms for 40 stops. Prints a savings table.
// Usage: node test/replay/route_bench_checks.mjs   (no build needed)

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const root = path.resolve(
  path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  ),
  "../..",
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-route-bench-"));
const outfile = path.join(tmp, "otherNext.mjs");
esbuild.buildSync({
  entryPoints: [path.join(root, "src/other/otherNext.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
  tsconfig: path.join(root, "tsconfig.node.json"),
  alias: {
    "@shared": path.join(root, "src/shared"),
    "@other": path.join(root, "src/other"),
  },
});
const N = await import(pathToFileURL(outfile).href);

const locations = JSON.parse(
  fs.readFileSync(path.join(root, "data/uex/locations.json"), "utf8"),
).locations;
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(root, "test/replay/fixtures/route_sets.json"),
    "utf8",
  ),
);

const results = [];
const check = (name, what, ok, detail = "") =>
  results.push({ name, what, ok: !!ok, detail });
const safe = (name, fn) => {
  try {
    fn();
  } catch (e) {
    check(
      name,
      "runs",
      false,
      String(e?.stack ?? e)
        .split("\n")
        .slice(0, 3)
        .join(" | "),
    );
  }
};

/** fixture set -> OtherJob[] (ids J1..Jn, steps s1..sn) */
const toJobs = (set) =>
  set.jobs.map((j, i) => ({
    id: j.id,
    ref: j.id,
    title: `Contract ${i + 1}`,
    kind: "delivery",
    reward: 0,
    status: "active",
    createdAt: i,
    steps: j.steps.map((s, k) => ({
      id: `s${k + 1}`,
      kind: s.kind,
      label: `${s.kind} ${s.item} ${s.location}`,
      location: s.location,
      ...(s.pickupLocation
        ? { pickupLocation: s.pickupLocation, pickedUp: !!s.pickedUp }
        : {}),
      item: s.item,
      have: 0,
      need: s.need ?? 1,
      done: false,
    })),
  }));

const BASE = { listOrder: "route", showAll: true, hideCompleted: true };
const key = (r) => `${r.job.id}:${r.step.id}`;
const order = (rows) => rows.map(key).join(",");
const itemOf = (s) => (s.item ?? "").trim().toLowerCase();
const total = (rows) => ({ m: N.routeTotal(rows), j: N.routeTotalJumps(rows) });
const notLonger = (a, b) =>
  a.j < b.j || (a.j === b.j && (a.m ?? 0) <= (b.m ?? 0) + 1e-6);

/** a delivery listed before any of its same-job, same-item open pickups */
const pickupViolations = (rows) => {
  const bad = [];
  rows.forEach((r, i) => {
    if (r.step.kind === "pickup" || r.step.pickupLocation || !itemOf(r.step))
      return;
    const p = rows.findLastIndex(
      (o) =>
        o.job.id === r.job.id &&
        o.step.kind === "pickup" &&
        !o.step.pickupLocation &&
        itemOf(o.step) === itemOf(r.step),
    );
    if (p > i) bad.push(`${key(r)} before ${key(rows[p])}`);
  });
  return bad;
};

/** a place whose measured stops are split by another place, when the later stop could have joined the earlier
 * visit (a delivery whose pickup comes after that visit is a forced split, not a fault) */
const splitPlaces = (rows) => {
  const m = rows.filter((r) => r.distance != null);
  const pickupAt = (r) =>
    r.step.kind === "pickup" || r.step.pickupLocation || !itemOf(r.step)
      ? -1
      : m.findLastIndex(
          (o) =>
            o.job.id === r.job.id &&
            o.step.kind === "pickup" &&
            !o.step.pickupLocation &&
            itemOf(o.step) === itemOf(r.step),
        );
  const lastVisit = new Map();
  const bad = [];
  m.forEach((r, i) => {
    const p = r.place;
    if (i > 0 && m[i - 1].place === p) {
      lastVisit.set(p, i);
      return;
    }
    if (lastVisit.has(p) && pickupAt(r) <= lastVisit.get(p))
      bad.push(`${p} (${key(r)})`);
    lastVisit.set(p, i);
  });
  return bad;
};

const ready = typeof N.listOpenStopsWithRoute === "function";
check("exports", "listOpenStopsWithRoute exported", ready);
check("exports", "improveRoute exported", typeof N.improveRoute === "function");
check(
  "exports",
  "pickupsBeforeDeliveries exported",
  typeof N.pickupsBeforeDeliveries === "function",
);

const table = [];
if (ready) {
  for (const set of fixture.sets) {
    const jobs = toJobs(set);
    const starts = [
      ...new Set([set.start, ...fixture.startPoints].filter(Boolean)),
    ];
    for (const start of starts) {
      const name = `${set.name} @ ${start}`;
      safe(name, () => {
        const today = N.listOpenStops(jobs, start, locations, BASE);
        const off = N.listOpenStopsWithRoute(jobs, start, locations, {
          ...BASE,
          routeOptimize: false,
        });
        check(
          name,
          "switch off = today (rows)",
          order(off.rows) === order(today),
          `${order(off.rows)} vs ${order(today)}`,
        );
        check(name, "switch off: route info null", off.route == null);
        check(
          name,
          "listOpenStops with routeOptimize false = today",
          order(
            N.listOpenStops(jobs, start, locations, {
              ...BASE,
              routeOptimize: false,
            }),
          ) === order(today),
        );
        const on = N.listOpenStopsWithRoute(jobs, start, locations, {
          ...BASE,
          routeOptimize: true,
        });
        const again = N.listOpenStopsWithRoute(jobs, start, locations, {
          ...BASE,
          routeOptimize: true,
        });
        check(
          name,
          "deterministic",
          order(on.rows) === order(again.rows),
          `${order(on.rows)} vs ${order(again.rows)}`,
        );
        check(
          name,
          "same stop set",
          on.rows.map(key).sort().join(",") === today.map(key).sort().join(","),
        );
        const a = total(today);
        const b = total(on.rows);
        check(
          name,
          "optimised never longer than nearest-next",
          notLonger(b, a),
          `opt ${b.j}j ${b.m} m; nn ${a.j}j ${a.m} m`,
        );
        const bad = pickupViolations(on.rows);
        check(
          name,
          "no delivery before its pickup",
          bad.length === 0,
          bad.join("; "),
        );
        const split = splitPlaces(on.rows);
        check(
          name,
          "same place stays together",
          split.length === 0,
          split.join("; "),
        );
        const tail = on.rows.findIndex((r) => r.distance == null);
        check(
          name,
          "stops without a point stay at the bottom",
          tail < 0 || on.rows.slice(tail).every((r) => r.distance == null),
        );
        const ri = on.route;
        const measuredOn = on.rows.filter((r) => r.distance != null).length;
        check(
          name,
          "route info set when on (stops = routed stops)",
          ri && ri.optimised === true && ri.stops === measuredOn,
          JSON.stringify(ri),
        );
        if (ri) {
          check(
            name,
            "route info nearest = today total",
            (ri.nearestMeters ?? null) === (a.m ?? null) &&
              ri.nearestJumps === a.j,
            `${ri.nearestMeters}/${ri.nearestJumps} vs ${a.m}/${a.j}`,
          );
          check(
            name,
            "route info optimised = rows total",
            (ri.optimisedMeters ?? null) === (b.m ?? null) &&
              ri.optimisedJumps === b.j,
            `${ri.optimisedMeters}/${ri.optimisedJumps} vs ${b.m}/${b.j}`,
          );
        }
        const measured = today.filter((r) => r.distance != null).length;
        const saved = a.m != null && b.m != null ? a.m - b.m : null;
        table.push({
          set: set.name,
          start,
          stops: today.length,
          measured,
          nnKm: a.m,
          optKm: b.m,
          saved,
          pct: saved != null && a.m ? (100 * saved) / a.m : null,
          jumps: `${a.j}->${b.j}`,
        });
      });
    }
  }

  // 40 stops: the first two synthetic sets together
  safe("timing", () => {
    const syn = fixture.sets.filter((s) => s.name.startsWith("synth-"));
    const jobs = [
      ...toJobs(syn[0]),
      ...toJobs(syn[1]).map((j) => ({
        ...j,
        id: `B${j.id}`,
        ref: `B${j.ref}`,
      })),
    ];
    const start = fixture.startPoints[0];
    const n = N.listOpenStops(jobs, start, locations, BASE).length;
    check("timing", "fixture: 40 stops", n === 40, `${n} stops`);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      N.listOpenStopsWithRoute(jobs, start, locations, {
        ...BASE,
        routeOptimize: true,
      });
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    check(
      "timing",
      "optimise 40 stops < 200 ms (median of 5)",
      times[2] < 200,
      `${times.map((t) => t.toFixed(1)).join(", ")} ms`,
    );
    console.log(
      `timing: 40 stops optimised in ${times.map((t) => t.toFixed(1)).join(", ")} ms (median ${times[2].toFixed(1)})`,
    );
  });
}

const km = (m) =>
  m == null
    ? "—"
    : (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 });
if (table.length) {
  console.log("\nRoute bench: nearest-next vs optimised (km)");
  console.log(
    "set".padEnd(26) +
      "start".padEnd(28) +
      "stops".padStart(6) +
      "nn km".padStart(14) +
      "opt km".padStart(14) +
      "saved km".padStart(12) +
      "%".padStart(7) +
      "  jumps",
  );
  for (const r of table) {
    console.log(
      r.set.padEnd(26) +
        r.start.slice(0, 27).padEnd(28) +
        `${r.measured}/${r.stops}`.padStart(6) +
        km(r.nnKm).padStart(14) +
        km(r.optKm).padStart(14) +
        km(r.saved).padStart(12) +
        (r.pct == null ? "—" : r.pct.toFixed(1)).padStart(7) +
        "  " +
        r.jumps,
    );
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of failed)
  console.log(`FAIL ${r.name}: ${r.what}${r.detail ? ` (${r.detail})` : ""}`);
console.log(
  `\nroute_bench_checks: ${results.length - failed.length}/${results.length} passed`,
);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
