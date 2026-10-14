// "Where am I?": the player's position from any clue (typed, ticks, Objective Complete,
// inventory, the map's bottom line, r_DisplayInfo text). Parsers and resolvers are pure.
import type { Location } from "@shared/types";
import type { GeoPoint } from "./otherGeo";
import { bodyRadius, type BodyRadiusLookup } from "./otherMarkers";
import {
  findBody,
  nearestPlace,
  resolveStartText,
  type StopPlace,
} from "./otherResolve";

export type WhereSource =
  | "typed"
  | "tick"
  | "objective"
  | "inventory"
  | "map"
  | "displayinfo";

export interface Where {
  /** nearest known place when close enough to count as "at" it (roster name); null = open space / unknown */
  name: string | null;
  /** what the UI shows, e.g. "HDRSO-Stott · 22.8 km", "Open space · 443,380 km from Hurston", "Seraphim Station" */
  label: string;
  /** star-frame position to measure from; absent when only a name is known */
  point?: GeoPoint;
  system: string | null;
  body: string | null;
  source: WhereSource;
  /** ISO time: log time for log clues, wall clock for map / display info / typed */
  at: string;
  /** position accuracy 0-10 when the clue was taken (see ACCURACY); fades with whereAccuracy() */
  accuracy?: number;
}

/** base accuracy per kind of reading (0 = no position). Typed has none: it is the user's choice. */
export const ACCURACY = {
  displayInfoBody: 10, // planet zone line / CamPos + body centre, checks pass
  displayInfoSpace: 9, // SolarSystem line, matches Root
  mapPlace: 8, // map line names a station / place
  inventory: 7,
  objective: 6,
  tick: 5,
  mapBody: 4, // map line names only a body
  mapCoords: 3, // map line coordinates only
  none: 0,
} as const;

/** map bottom line: "STANTON > HURSTON > 0.00° 0.00° 12.85GM" (body and place optional) */
export interface MapLine {
  system: string;
  body?: string;
  place?: string;
  latDeg: number;
  lonDeg: number;
  distGm: number;
}

/** r_DisplayInfo 3 text block (upper right) */
export interface DisplayInfo {
  /** "Stanton" from "Current player location : Stanton1" / "StantonSolarSystem" or the zone names */
  system: string | null;
  /** "Hurston" from "Planet:OOC_Stanton_1_Hurston" */
  body: string | null;
  /** "CamPos Planet Zone: x y z" in metres, body frame (turns with the body; matches our data's surface frame) */
  planetPos?: { x: number; y: number; z: number };
  /** "Zone: SolarSystem_… Pos: x y z" converted km -> metres, star frame */
  solarPos?: { x: number; y: number; z: number };
  /** "Radius:" metres */
  radiusM?: number;
  /** "Altitude" metres above the body surface */
  altitudeM?: number;
  /** set by resolveDisplayInfo (O3): 'screen' = altitudeM kept; 'computed' = altitudeM was garbled/missing/implausible
   *  and |position| − body radius was used instead (altitudeComputedM) */
  altitudeSource?: "screen" | "computed";
  /** |position − body centre| − body radius, metres (resolveDisplayInfo, when a body position and a radius are known) */
  altitudeComputedM?: number;
  /** every "Zone: <name> Pos: x y z" line, metres (top 4: ship, planet zone, SolarSystem, Root) */
  zones?: { name: string; pos: { x: number; y: number; z: number } }[];
  /** ship zone ("MISC_Hull_B …") local position, metres */
  shipPos?: { x: number; y: number; z: number };
  /** planet zone name, e.g. "OOC_Stanton_1_Hurston" */
  planetZone?: string;
  /** "Zone: Root Pos:" metres (should equal solarPos) */
  rootPos?: { x: number; y: number; z: number };
  /** "ElevationUnderCam" metres */
  elevationM?: number;
  /** "XYPos: x y" */
  xyPos?: { x: number; y: number };
  /** raw "Current player location : …" value, e.g. "Stanton1" */
  playerLocation?: string;
  /** body index from "Stanton1" (1 = Hurston, 2 = Crusader, 3 = ArcCorp, 4 = microTech) */
  playerLocationIndex?: number;
  /** "ServerTime: Wed Oct 14 14:05:05 2026" as ISO (UTC) */
  serverTime?: string;
  /** "UniverseTime: …" raw */
  universeTime?: string;
  /** "Tracked mission : <name> [<uuid>]" */
  trackedMission?: { name: string; id: string };
  /** sense checks: what was used, what was dropped and why (diagnostics) */
  checks?: { item: string; ok: boolean; why?: string }[];
}

/** systems we know; OCR names map to these by prefix */
const SYSTEMS = ["Stanton", "Pyro", "Nyx"] as const;

/**
 * System name from any OCR form: "Stantonl" / "Stanton1" / "Stanton 1a" / "StantonSolarSystem" / "STANTON SYSTEM"
 * -> "Stanton". Unknown names (garbled reads: "Zone", "Zope", "Stantepl") -> ''.
 */
export function knownSystem(raw: string | null | undefined): string {
  return systemWord(raw).known;
}

/** the known system and the cleaned last word (title-cased) it came from */
function systemWord(raw: string | null | undefined): {
  known: string;
  word: string;
} {
  if (!raw) return { known: "", word: "" };
  const w = raw
    .replace(/[_\s]*solar[_\s]*system\w*$/i, "")
    .replace(/[_\s]*system$/i, "")
    .trim();
  const words = w.split(/[\s_]+/).filter((s) => /[A-Za-z]/.test(s));
  const last = (words.pop() ?? "").replace(/[^A-Za-z0-9|]/g, "");
  const lower = last.toLowerCase();
  const core = last.replace(/[0-9|]+[a-z]?$/, "");
  const word = core ? core[0].toUpperCase() + core.slice(1).toLowerCase() : "";
  for (const s of SYSTEMS)
    if (lower.startsWith(s.toLowerCase())) return { known: s, word };
  if (core.length >= 4)
    for (const s of SYSTEMS)
      if (s.toLowerCase().startsWith(core.toLowerCase()))
        return { known: s, word };
  return { known: "", word };
}

/** map line system: "STANTON SYSTEM" / "StantonSolarSystem" -> "Stanton"; an unknown name stays, title-cased */
function titleSystem(raw: string): string {
  const { known, word } = systemWord(raw);
  return known || word;
}

/** OCR number: '-'/'–'/'−' minus, ',' read for '.', stray space after the sign */
function num(raw: string): number {
  let t = raw.replace(/[–—−]/g, "-").replace(/\s+/g, "");
  t = t.includes(".") ? t.replace(/,/g, "") : t.replace(/,/g, ".");
  return Number(t);
}

const MAP_COORDS =
  /(-?\s?\d+(?:[.,]\d+)?)\s*[°ºo*˚]?\s*([-–−]?\s?\d+(?:[.,]\d+)?)\s*[°ºo*˚]?\s*(\d+(?:[.,]\d+)?)\s*([GMK])\s*M\b/i;

/** CONTRACT (where-parse agent implements). Tolerates OCR noise (° as o/º, > as ›, spaces, GM/Gm). */
export function parseMapLine(text: string): MapLine | null {
  if (!text) return null;
  for (const rawLine of text.split(/\r?\n/).reverse()) {
    const line = rawLine.replace(/[›»〉>]/g, ">").replace(/[–−]/g, "-");
    if (!line.includes(">")) continue;
    const m = MAP_COORDS.exec(line);
    if (!m) continue;
    const names = line
      .slice(0, m.index)
      .split(">")
      .map((t) =>
        t
          .replace(/^[^A-Za-z0-9"]+|[^A-Za-z0-9"']+$/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((t) => t.length > 0);
    if (!names.length) continue;
    const system = titleSystem(names[0]);
    if (!/^[A-Za-z]{2,}$/.test(system)) continue;
    const unit = m[4].toUpperCase();
    const scale = unit === "G" ? 1 : unit === "M" ? 1e-3 : 1e-6;
    const latDeg = num(m[1]);
    const lonDeg = num(m[2]);
    const distGm = num(m[3]) * scale;
    if (
      ![latDeg, lonDeg, distGm].every(Number.isFinite) ||
      Math.abs(latDeg) > 90 ||
      Math.abs(lonDeg) > 360
    )
      continue;
    const out: MapLine = { system, latDeg, lonDeg, distGm };
    if (names.length >= 2) out.body = names[1];
    if (names.length >= 3) out.place = names[names.length - 1];
    return out;
  }
  return null;
}

type Vec = { x: number; y: number; z: number };

/** one OCR number with its own unit: "-0.94m", "12849498.,1180km", "-233.7724Kkm", "- 725441.09" */
const NUM_RE = /([-+]?)\s?(\d+(?:[.,]+\d+)?)\s*(k+m|m)?(?![a-z])/gi;
/** a line holding only numbers (a "Pos:" whose numbers wrapped to the next line) */
const NUM_LINE = /^[\s~]*(?:[-+]?\s?\d+(?:[.,]+\d+)?\s*(?:k*m)?\s*)+$/i;

function nums(s: string, defUnit: "m" | "km"): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(NUM_RE)) {
    const v =
      num(m[2]) * ((m[3] ?? defUnit).toLowerCase().includes("k") ? 1000 : 1);
    if (Number.isFinite(v)) out.push(m[1] === "-" ? -v : v);
  }
  return out;
}

const vec = (v: number[]): Vec | undefined =>
  v.length >= 3 ? { x: v[0], y: v[1], z: v[2] } : undefined;

/** "OOC_Stanton_1_Hurston" / "00C Stanton 1 Hurston" / "OOC_Stanton_1a_Arial" */
const OOC_RE =
  /^[O0][O0]C[_\s]*([A-Za-z]+?)[_\s]*([0-9lI|]{1,2}[a-z]?)[_\s]+([A-Za-z][\w\s'-]*?)\s*$/i;

function oocParts(
  name: string,
): { system: string; index: string; body: string } | null {
  const m = OOC_RE.exec(name.trim());
  if (!m) return null;
  return {
    system: knownSystem(m[1]),
    index: m[2].replace(/[lI|]/g, "1"),
    body: bodyName(m[3]),
  };
}

function bodyName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** first number after a label on the same line */
function after(
  t: string,
  label: RegExp,
  defUnit: "m" | "km" = "m",
  count = 1,
): number[] | undefined {
  const m = label.exec(t);
  if (!m) return undefined;
  const rest = t.slice(m.index + m[0].length).split(/\r?\n/)[0];
  const v = nums(rest, defUnit);
  return v.length >= count ? v.slice(0, count) : undefined;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** "ServerTime: Wed Oct 14 14:05:05 2026" -> ISO (UTC) */
function serverTime(t: string): string | undefined {
  const m =
    /Server\s*Time\s*[:;]?\s*(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\w*\s+([0-9OIl]{1,2})\s+([0-9OIl]{1,2})\s*[:.]\s*([0-9OIl]{2})\s*[:.]\s*([0-9OIl]{2})\s+([0-9OIl]{4})/i.exec(
      t,
    );
  if (!m) return undefined;
  const d = (s: string): number =>
    Number(s.replace(/O/g, "0").replace(/[Il]/g, "1"));
  const mon = MONTHS.indexOf(m[1].toLowerCase());
  if (mon < 0) return undefined;
  const ms = Date.UTC(d(m[6]), mon, d(m[2]), d(m[3]), d(m[4]), d(m[5]));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** "Tracked mission : <name> [<uuid>]"; id lower-case with O->0 and I/l/| -> 1 (OCR) */
function trackedMission(t: string): { name: string; id: string } | undefined {
  const m = /Tracked\s*mission\s*[:;]?\s*([^\r\n]*)/i.exec(t);
  if (!m) return undefined;
  const line = m[1];
  const b = /[[({]/.exec(line);
  const nameRaw = b ? line.slice(0, b.index) : (line.split(/\s+/)[0] ?? "");
  const idRaw = b ? line.slice(b.index + 1) : line.slice(nameRaw.length);
  const name = nameRaw.trim().replace(/[^\w-]+$/, "");
  const id = idRaw
    .replace(/[\])}].*$/, "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .toLowerCase()
    .replace(/[^0-9a-z-]/g, "");
  if (!name && id.length < 8) return undefined;
  return { name, id };
}

/**
 * CONTRACT: the whole r_DisplayInfo panel -> every field we know. null when there is no usable position
 * (planet zone / CamPos / SolarSystem / Root). system may be null (top lines only).
 */
export function parseDisplayInfo(text: string): DisplayInfo | null {
  if (!text) return null;
  const t = text.replace(/[–—−]/g, "-");
  const lines = t.split(/\r?\n/);

  // every "Zone: <name> Pos: x y z" line; numbers may wrap to the next line(s)
  const zones: { name: string; pos: Vec }[] = [];
  let shipPos: Vec | undefined;
  let planetZone: string | undefined;
  let zonePos: Vec | undefined;
  let solarPos: Vec | undefined;
  let rootPos: Vec | undefined;
  for (let i = 0; i < lines.length; i++) {
    const zm = /Z[o0]ne\s*[:;]?\s*(.*?)\s*P[o0]s\b\s*[:;]?\s*(.*)$/i.exec(
      lines[i],
    );
    if (!zm) continue;
    const v = nums(zm[2], "km");
    for (let k = i + 1; v.length < 3 && k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (!NUM_LINE.test(lines[k])) break;
      v.push(...nums(lines[k], "km"));
      i = k;
    }
    const pos = vec(v);
    if (!pos) continue;
    const name = zm[1]
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
      .replace(/\s+/g, " ");
    zones.push({ name, pos });
    if (oocParts(name)) {
      if (!planetZone) {
        planetZone = name;
        zonePos = pos;
      }
    } else if (/^Solar[_\s]*System/i.test(name)) solarPos ??= pos;
    else if (/^R[o0]{2}t\b/i.test(name)) rootPos ??= pos;
    else shipPos ??= pos;
  }
  const camPos = vec(after(t, /CamPos\s*Planet\s*Zone\s*[:;]?/i, "m", 3) ?? []);

  // system / body
  let playerLocation: string | undefined;
  let playerLocationIndex: number | undefined;
  let system: string | null = null;
  const loc =
    /player\s*location\s*[:;]?\s*([A-Za-z]+(?:\s?[0-9|]{1,2}[a-z]?\b)?)/i.exec(
      t,
    );
  if (loc) {
    playerLocation = loc[1].replace(/\s+/g, "");
    system = knownSystem(playerLocation) || null;
    const rest =
      system && playerLocation.toLowerCase().startsWith(system.toLowerCase())
        ? playerLocation.slice(system.length)
        : "";
    const im = /^([0-9lI|]{1,2})[a-z]?$/.exec(rest);
    if (im) playerLocationIndex = Number(im[1].replace(/[lI|]/g, "1"));
  }
  const zoneOoc = planetZone ? oocParts(planetZone) : null;
  const planet =
    /Planet\s*[:;]?\s*[O0][O0]C[_\s]*([A-Za-z]+?)[_\s]*([0-9lI|]{1,2}[a-z]?)[_\s]+([^\s(]+(?:[_ ][^\s(]+)*)/i.exec(
      t,
    );
  if (!system && zoneOoc) system = zoneOoc.system || null;
  if (!system && planet) system = knownSystem(planet[1]) || null;
  const body = zoneOoc?.body || (planet ? bodyName(planet[3]) : "") || null;

  const planetPos = camPos ?? zonePos;
  if (!planetPos && !solarPos && !rootPos) return null;
  const out: DisplayInfo = { system, body };
  if (planetPos) out.planetPos = planetPos;
  if (solarPos) out.solarPos = solarPos;
  if (rootPos) out.rootPos = rootPos;
  if (zones.length) out.zones = zones;
  if (shipPos) out.shipPos = shipPos;
  if (planetZone) out.planetZone = planetZone;
  const radius = after(t, /Radius\s*[:;]?/i);
  if (radius) out.radiusM = radius[0];
  const alt = after(t, /Altitude\s*[:;]?/i);
  if (alt) out.altitudeM = alt[0];
  const elev = after(t, /Elevation\s*Under\s*Cam\s*[:;]?/i);
  if (elev) out.elevationM = elev[0];
  const xy = after(t, /XYPos\s*[:;]?/i, "m", 2);
  if (xy) out.xyPos = { x: xy[0], y: xy[1] };
  if (playerLocation) out.playerLocation = playerLocation;
  if (playerLocationIndex !== undefined)
    out.playerLocationIndex = playerLocationIndex;
  const st = serverTime(t);
  if (st) out.serverTime = st;
  const ut = /Universe\s*Time\s*[:;]?\s*([^\r\n]+)/i.exec(t);
  if (ut) out.universeTime = ut[1].trim();
  const tm = trackedMission(t);
  if (tm) out.trackedMission = tm;
  return out;
}

// ---- resolving against the roster (names via otherResolve: findBody / resolveStartText / nearestPlace) ----

type Pt = { x: number; y: number; z: number };
type Placed = Location & Pt;

/** text -> the one resolver's answer (main passes a closure with match memory) */
export type WhereResolve = (text: string) => StopPlace;

const hasXyz = (l: Location | null | undefined): l is Placed =>
  !!l &&
  typeof l.x === "number" &&
  typeof l.y === "number" &&
  typeof l.z === "number";

const sameSystem = (a: string | undefined | null, b: string | null): boolean =>
  !b || !a || titleSystem(a).toLowerCase() === titleSystem(b).toLowerCase();

/** roster places with coords in this system (geometry pool, not name matching) */
function placed(locations: Location[], system: string | null): Placed[] {
  const out: Placed[] = [];
  for (const l of locations)
    if (hasXyz(l) && sameSystem(l.system, system)) out.push(l);
  return out;
}

const dist = (a: Pt, b: Pt): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** resolver statuses sure enough to place the player at a roster place */
const NOT_SURE = new Set(["none", "unsure", "mismatch"]);

/** a body by name (findBody), in the read system first */
function bodyByName(
  name: string | undefined | null,
  locations: Location[],
  system: string | null,
): Placed | null {
  if (!name) return null;
  const b = findBody(name, locations, system ?? undefined);
  return hasXyz(b) && sameSystem(b.system, system) ? b : null;
}

/** a place by name through the one resolver; only a sure match with coords in the read system */
function placeByName(
  name: string | undefined | null,
  resolve: WhereResolve,
  system: string | null,
): Placed | null {
  if (!name?.trim()) return null;
  const sp = resolve(name);
  const m = sp.match;
  return m &&
    !NOT_SURE.has(sp.status) &&
    hasXyz(m) &&
    sameSystem(m.system, system)
    ? m
    : null;
}

/** names of planets and moons: roster entries some other entry names as its body */
function bodyNames(pool: Placed[]): Set<string> {
  const s = new Set<string>();
  for (const l of pool) if (l.body) s.add(l.body.toLowerCase());
  return s;
}

function bodies(pool: Placed[]): Placed[] {
  const names = bodyNames(pool);
  const out: Placed[] = [];
  for (const l of pool) if (names.has(l.name.toLowerCase())) out.push(l);
  return out;
}

const isBody = (loc: Placed, pool: Placed[]): boolean =>
  bodyNames(pool).has(loc.name.toLowerCase());

/** nearest place in the pool (nearestPlace, no distance cap) */
function nearest(p: Pt, pool: Placed[]): { loc: Placed; d: number } | null {
  const hit = nearestPlace(p, pool, Infinity);
  return hit && hasXyz(hit.place) ? { loc: hit.place, d: hit.meters } : null;
}

const defaultResolve =
  (locations: Location[]): WhereResolve =>
  (text) =>
    resolveStartText(text, { locations, useMarker: false });

/** "22.8 km", "443,380 km", "12.5 Gm"; under 1 km in metres */
export function formatWhereDistance(m: number): string {
  const km = Math.abs(m) / 1000;
  if (km < 1) return `${Math.round(Math.abs(m))} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  if (km < 10_000_000) return `${Math.round(km).toLocaleString("en-US")} km`;
  return `${(km / 1e6).toFixed(1)} Gm`;
}

function openSpace(p: Pt, pool: Placed[], prefer?: Placed | null): string {
  const ref = prefer
    ? { loc: prefer, d: dist(p, prefer) }
    : nearest(p, bodies(pool));
  return ref
    ? `Open space · ${formatWhereDistance(ref.d)} from ${ref.loc.name}`
    : "Open space";
}

const geo = (p: Pt, system: string | null, body: string | null): GeoPoint => ({
  x: p.x,
  y: p.y,
  z: p.z,
  system,
  body,
});

/**
 * CONTRACT: most specific name wins (place, then body); 0°/0° coordinates are ignored as a position.
 * Body names via findBody, place names via `resolve` (default: resolveStartText without memory).
 */
export function resolveMapLine(
  line: MapLine,
  locations: Location[],
  at: string,
  resolve: WhereResolve = defaultResolve(locations),
): Where | null {
  const system = line.system ? titleSystem(line.system) : null;
  const pool = placed(locations, system);
  const bodyLoc =
    bodyByName(line.body, locations, system) ??
    placeByName(line.body, resolve, system);
  const placeLoc = line.place
    ? (bodyByName(line.place, locations, system) ??
      placeByName(line.place, resolve, system))
    : null;
  for (const loc of [placeLoc, bodyLoc]) {
    if (!loc) continue;
    const body = isBody(loc, pool)
      ? loc.name
      : (loc.body ?? bodyLoc?.name ?? null);
    const accuracy = isBody(loc, pool) ? ACCURACY.mapBody : ACCURACY.mapPlace;
    return {
      name: loc.name,
      label: loc.name,
      point: geo(loc, system, body),
      system,
      body,
      source: "map",
      at,
      accuracy,
    };
  }
  if (line.latDeg === 0 && line.lonDeg === 0) return null;
  if (!(line.distGm > 0)) return null;
  const r = line.distGm * 1e9;
  const lat = (line.latDeg * Math.PI) / 180;
  const lon = (line.lonDeg * Math.PI) / 180;
  const p = {
    x: r * Math.cos(lat) * Math.cos(lon),
    y: r * Math.cos(lat) * Math.sin(lon),
    z: r * Math.sin(lat),
  };
  return {
    name: null,
    label: openSpace(p, pool),
    point: geo(p, system, null),
    system,
    body: null,
    source: "map",
    at,
    accuracy: ACCURACY.mapCoords,
  };
}

/** "Current player location : Stanton<n>" -> planet */
const STANTON_INDEX: Record<number, string> = {
  1: "Hurston",
  2: "Crusader",
  3: "ArcCorp",
  4: "microTech",
};

const NEAR_M = 100_000;
const STALE_MS = 2 * 60_000;
/**
 * O3 tolerance: the screen's Altitude is height above the ground, |position| − radius is height above the body's
 * radius, so they differ by the ground height (a few km at most). The screen value is kept when it is within 5 km of
 * the computed one with an exact radius (the panel's "Radius:" or the planet table, same 5 km as the
 * "|pos| ≈ radius + altitude" check), or within 20 km with the roster's estimated radius.
 */
export const ALT_TOL_EXACT_M = 5_000;
export const ALT_TOL_ESTIMATE_M = 20_000;
/** a screen Altitude outside this range is never plausible (metres) */
const ALT_MIN_M = -1_000;
const ALT_MAX_M = 1e13;

function formatUp(m: number): string {
  return m < 1000
    ? `${Math.max(0, Math.round(m))} m up`
    : `${Math.round(m / 1000).toLocaleString("en-US")} km up`;
}

/**
 * CONTRACT: whole-panel resolve, best first, each step only if its sense checks pass (recorded in info.checks):
 * 1. near a body: planet zone line / CamPos + body centre (km line ≈ CamPos within 1 km, |pos| ≈ radius + altitude
 *    within 5 km, player-location index agrees with the body; altitude over 100 km skips this step);
 *    near a body but step 1 fails -> null (the star-frame lines turn with the planet; not used there);
 *    the body is looked up in the read system, then in every system (a misread system name);
 * 2. in space only: SolarSystem line (== Root within 1 km when Root is there), else Root alone.
 * null = nothing usable (the caller falls back to the map line). ServerTime > 2 min off `at` = maybe stale (accuracy −3).
 * opts.bodyRadius = planet table (otherBodies) for the "N km up" label when the panel's "Radius:" line is cut off;
 * without it (or when it doesn't know the body) the roster estimate (otherMarkers.bodyRadius) is used.
 * Body names via findBody, then opts.resolve (default: resolveStartText without memory); nearest place via nearestPlace.
 */
export function resolveDisplayInfo(
  info: DisplayInfo,
  locations: Location[],
  at: string,
  opts?: { bodyRadius?: BodyRadiusLookup; resolve?: WhereResolve },
): Where | null {
  const resolve = opts?.resolve ?? defaultResolve(locations);
  /** body by name (findBody), else the resolver's sure answer (a garbled or learned name) */
  const bodyOrPlace = (name: string, sys: string | null): Placed | null =>
    bodyByName(name, locations, sys) ?? placeByName(name, resolve, sys);
  const checks: NonNullable<DisplayInfo["checks"]> = [];
  info.checks = checks;
  let system = info.system ? knownSystem(info.system) || null : null;
  let pool = placed(locations, system);
  const km = (m: number): string => `${(m / 1000).toFixed(1)} km`;

  let p: Pt | null = null;
  let nearLoc: Placed | null = null;
  let up: number | undefined;
  let accuracy: number = ACCURACY.none;

  // 1. near a body
  const zone = info.planetZone
    ? info.zones?.find((z) => z.name === info.planetZone)
    : undefined;
  const zonePos = zone?.pos;
  const cam =
    info.planetPos && !(zonePos && dist(info.planetPos, zonePos) < 1e-6)
      ? info.planetPos
      : undefined;
  const zoneBody = info.planetZone
    ? oocParts(info.planetZone)?.body
    : undefined;
  const bodyLabel = zoneBody || info.body;
  const radius = info.radiusM;
  // the near body, looked up once: the read system first, then every system (a misread system name)
  let bodyHit: { loc: Placed; system: string | null } | null | undefined;
  const nearBody = (): { loc: Placed; system: string | null } | null => {
    if (bodyHit !== undefined) return bodyHit;
    bodyHit = null;
    if (!bodyLabel) return bodyHit;
    const own = bodyOrPlace(bodyLabel, system);
    if (own) bodyHit = { loc: own, system };
    else if (system) {
      const any = bodyOrPlace(bodyLabel, null);
      if (any) bodyHit = { loc: any, system: knownSystem(any.system) || null };
    }
    return bodyHit;
  };

  // O3: the screen's Altitude is kept only when it is plausible and agrees with |position| − radius;
  // otherwise it counts as missing and the computed height is used (the "N km up" label, the near test)
  let alt: number | undefined = info.altitudeM;
  let computedUp: number | undefined;
  const rel = cam ?? zonePos;
  if (rel) {
    let r: number | undefined;
    let exact = false;
    if (typeof radius === "number" && radius > 0) {
      r = radius;
      exact = true;
    } else {
      const b = nearBody()?.loc.name;
      const t = b ? opts?.bodyRadius?.(b) : undefined;
      if (typeof t === "number" && Number.isFinite(t) && t > 0) {
        r = t;
        exact = true;
      } else if (b) r = bodyRadius(b, locations, opts?.bodyRadius) ?? undefined;
    }
    if (typeof r === "number" && Number.isFinite(r)) {
      const up = (v: Pt): number => Math.hypot(v.x, v.y, v.z) - r!;
      const tol = exact ? ALT_TOL_EXACT_M : ALT_TOL_ESTIMATE_M;
      const c = up(rel);
      info.altitudeComputedM = c;
      // well inside the body: the position line is the garbled one, so it can't fix the altitude
      if (c >= -tol) computedUp = c;
      else
        checks.push({
          item: "altitude from position",
          ok: false,
          why: `${km(c)} from position is inside the body: not used`,
        });
      // computedUp undefined: nothing to compare with; the screen altitude is judged on its own below
      if (computedUp !== undefined && typeof alt === "number") {
        const a = alt;
        const sane = Number.isFinite(a) && a >= ALT_MIN_M && a <= ALT_MAX_M;
        const agrees =
          sane && [cam, zonePos].some((v) => v && Math.abs(up(v) - a) <= tol);
        if (!agrees) {
          checks.push({
            item: "altitude from position",
            ok: true,
            why: `screen ${sane ? km(a) : "unreadable"} vs ${km(computedUp)} from position (${exact ? "exact" : "estimated"} radius, tolerance ${km(tol)}): using ${km(computedUp)}`,
          });
          alt = undefined;
        }
      } else if (computedUp !== undefined) {
        checks.push({
          item: "altitude from position",
          ok: true,
          why: `no screen altitude: ${km(computedUp)} from position (${exact ? "exact" : "estimated"} radius)`,
        });
      }
    }
  }
  if (
    typeof alt === "number" &&
    !(Number.isFinite(alt) && alt >= ALT_MIN_M && alt <= ALT_MAX_M)
  ) {
    checks.push({
      item: "screen altitude",
      ok: false,
      why: "implausible: not used",
    });
    alt = undefined;
  }
  if (typeof alt === "number") info.altitudeSource = "screen";
  else if (computedUp !== undefined) info.altitudeSource = "computed";

  let near = !!zonePos;
  if (!near && cam) {
    if (typeof alt === "number") near = alt < NEAR_M;
    else if (computedUp !== undefined) near = computedUp < NEAR_M;
  }
  if (typeof alt === "number" && alt > NEAR_M && (zonePos || cam)) {
    checks.push({
      item: "near a body",
      ok: false,
      why: `altitude ${km(alt)} > 100 km: using the SolarSystem line`,
    });
    near = false;
  }
  if (near) {
    const hit = nearBody();
    nearLoc = hit?.loc ?? null;
    if (hit && hit.system !== system) {
      // system read wrong: the body was in another system's pool
      system = hit.system;
      pool = placed(locations, system);
    }
    let ok = !!nearLoc;
    if (!nearLoc)
      checks.push({
        item: "body centre",
        ok: false,
        why: `${bodyLabel ?? "no body"} not in the roster`,
      });
    const fits = (v: Pt): boolean =>
      typeof radius !== "number" ||
      typeof alt !== "number" ||
      Math.abs(Math.hypot(v.x, v.y, v.z) - (radius + alt)) <= 5000;
    let pos = cam ?? zonePos;
    if (cam && zonePos) {
      const d = dist(cam, zonePos);
      const same = d <= 1000;
      checks.push({
        item: "planet zone line ≈ CamPos",
        ok: same,
        why: `${km(d)} apart`,
      });
      if (!same) pos = fits(cam) && !fits(zonePos) ? cam : zonePos;
    }
    if (pos && typeof radius === "number" && typeof alt === "number") {
      const off = Math.abs(Math.hypot(pos.x, pos.y, pos.z) - (radius + alt));
      const good = off <= 5000;
      checks.push({
        item: "|pos| ≈ radius + altitude",
        ok: good,
        why: `${km(off)} off`,
      });
      if (!good) ok = false;
    }
    if (
      nearLoc &&
      info.playerLocationIndex !== undefined &&
      (system ?? "Stanton") === "Stanton"
    ) {
      const want = STANTON_INDEX[info.playerLocationIndex];
      if (want) {
        // the index's body through the resolver; then a plain identity compare on roster names
        const wantBody = findBody(want, locations);
        const agree =
          !!wantBody &&
          (nearLoc.name === wantBody.name || nearLoc.body === wantBody.name);
        checks.push({
          item: "player location index agrees with body",
          ok: agree,
          why: `${info.playerLocation} vs ${nearLoc.name}`,
        });
        if (!agree) ok = false;
      }
    }
    if (ok && nearLoc && pos) {
      p = { x: nearLoc.x + pos.x, y: nearLoc.y + pos.y, z: nearLoc.z + pos.z };
      accuracy = ACCURACY.displayInfoBody;
      const r =
        typeof radius === "number"
          ? radius
          : (bodyRadius(nearLoc.name, locations, opts?.bodyRadius) ?? NaN);
      up = typeof alt === "number" ? alt : Math.hypot(pos.x, pos.y, pos.z) - r;
      if (!Number.isFinite(up)) up = undefined;
      checks.push({
        item: `used: ${cam && pos === cam ? "CamPos" : "planet zone line"} + ${nearLoc.name} centre`,
        ok: true,
      });
    } else {
      // the SolarSystem / Root lines turn with the planet here and don't match roster places
      checks.push({
        item: "position",
        ok: false,
        why: `near ${bodyLabel || "a body"} but the body position failed: star-frame lines not used on a planet`,
      });
      return null;
    }
  }

  // 2. SolarSystem line / Root (space only)
  if (!p) {
    const s = info.solarPos;
    const root = info.rootPos;
    if (s && root) {
      const d = dist(s, root);
      const same = d <= 1000;
      checks.push({
        item: "SolarSystem line == Root",
        ok: same,
        why: `${km(d)} apart`,
      });
      if (same) p = s;
    } else if (s) p = s;
    else if (root) p = root;
    if (p) {
      accuracy = ACCURACY.displayInfoSpace;
      checks.push({
        item: `used: ${p === s ? "SolarSystem line" : "Root line"}`,
        ok: true,
      });
    }
  }
  if (!p) {
    checks.push({
      item: "position",
      ok: false,
      why: "no usable line: falling back to the map line",
    });
    return null;
  }

  // O4: ServerTime vs the PC clock
  if (info.serverTime) {
    const off = Math.abs(Date.parse(info.serverTime) - Date.parse(at));
    if (Number.isFinite(off)) {
      const fresh = off <= STALE_MS;
      checks.push({
        item: "ServerTime vs PC clock",
        ok: fresh,
        why: fresh
          ? `${Math.round(off / 1000)} s off`
          : `${Math.round(off / 60_000)} min off: maybe stale (accuracy −3)`,
      });
      if (!fresh) accuracy = Math.max(1, accuracy - 3);
    }
  }

  const base = { source: "displayinfo" as const, at, accuracy };
  if (nearLoc) {
    const body = nearLoc.name;
    const hit = nearest(
      p,
      pool.filter((l) => l !== nearLoc),
    );
    if (hit && hit.d <= 50_000) {
      return {
        ...base,
        name: hit.loc.name,
        label: `${hit.loc.name} · ${formatWhereDistance(hit.d)}`,
        point: geo(p, system, body),
        system,
        body,
      };
    }
    const parts = [body];
    if (up !== undefined) parts.push(formatUp(up));
    if (hit) parts.push(`${formatWhereDistance(hit.d)} from ${hit.loc.name}`);
    return {
      ...base,
      name: null,
      label: parts.join(" · "),
      point: geo(p, system, body),
      system,
      body,
    };
  }
  const hit = nearest(p, pool);
  if (hit && hit.d <= 100_000) {
    const body = isBody(hit.loc, pool) ? hit.loc.name : (hit.loc.body ?? null);
    const sys = system ?? (knownSystem(hit.loc.system) || null);
    return {
      ...base,
      name: hit.loc.name,
      label: `${hit.loc.name} · ${formatWhereDistance(hit.d)}`,
      point: geo(p, sys, body),
      system: sys,
      body,
    };
  }
  const bodyLoc = info.body ? bodyOrPlace(info.body, system) : null;
  return {
    ...base,
    name: null,
    label: openSpace(p, pool, bodyLoc),
    point: geo(p, system, null),
    system,
    body: null,
  };
}

/** main <-> renderer result of one WHERE AM I read */
export interface WhereRunResult {
  ok: boolean;
  where?: Where;
  /** which zone gave the answer */
  zone?: 1 | 2;
  /** raw OCR text per zone, for TEST and diagnostics */
  raw: { zone1?: string; zone2?: string };
  error?: string;
  ms: number;
  /** what started it */
  why?: "hotkey" | "button" | "live" | "calibrate";
  /** one-line feedback, e.g. "Panel unreadable → used map line" */
  note?: string;
  /** parsed panel, for diagnostics and the tracked mission */
  info?: DisplayInfo;
}

/** accuracy now: w.accuracy minus 1 per 5 min since w.at, never below 1; 0 for null/undefined or no accuracy. Typed -> null (no score). */
export function whereAccuracy(
  w: Where | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!w) return 0;
  if (w.source === "typed") return null;
  const a = w.accuracy;
  if (typeof a !== "number" || !(a > 0)) return 0;
  const age = now - Date.parse(w.at);
  const fade =
    Number.isFinite(age) && age > 0 ? Math.floor(age / (5 * 60_000)) : 0;
  return Math.max(1, Math.min(10, Math.round(a)) - fade);
}

/** 10-9 exact, 8-6 good, 5-4 rough, 3-1 guess, 0 none */
export function accuracyWord(
  score: number,
): "exact" | "good" | "rough" | "guess" | "none" {
  if (!(score >= 1)) return "none";
  if (score >= 9) return "exact";
  if (score >= 6) return "good";
  if (score >= 4) return "rough";
  return "guess";
}
