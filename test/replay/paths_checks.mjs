// Data folder checks: bundles src/main/paths.ts, dataCheck.ts and dataFolderIpc.ts with a stub 'electron', a stub logger
// and a temp HOME, then checks the default folder, settings.json placement, overrides (usable / unusable -> fallback with
// reason), reset, dataPath dirs, cachePath, that no file under src/ other than src/main/paths.ts still calls
// getPath('userData'), the SuperCargo files list (holdsData), checkDataFolder (good / damaged / bad shape), moveForRepair
// (structure kept, settings.json stays, " (2)" on a clash), CHANGE (used as is, copy, usedExisting, needsRepair, repair)
// and the start-up check (Quit / Reset and continue).
// Usage: node test/replay/paths_checks.mjs   (no build needed)   --verbose prints every check

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-paths-"));
const home = path.join(tmp, "home");
const userData = path.join(tmp, "electron-userData");
fs.mkdirSync(home, { recursive: true });
// os.homedir() reads HOME (POSIX) / USERPROFILE (Windows) at call time.
process.env.HOME = home;
process.env.USERPROFILE = home;
globalThis.__scUserData = userData;
globalThis.__scLog = [];
globalThis.__scDialog = { calls: [], response: 1 };

const electronStub = {
  name: "electron-stub",
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({
      path: "electron",
      namespace: "electron-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
      contents: [
        "export const app = { getPath: (n) => { if (n !== 'userData') throw new Error('stub: ' + n); return globalThis.__scUserData }, on: () => {}, relaunch: () => {}, quit: () => {} }",
        "export const dialog = { showMessageBox: async (o) => { globalThis.__scDialog.calls.push(o); return { response: globalThis.__scDialog.response } }, showErrorBox: (t, m) => { globalThis.__scDialog.calls.push({ error: t, message: m }) }, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }",
        "export const ipcMain = { handle: () => {} }",
        "export const shell = { openPath: async () => '' }",
        "export class BrowserWindow {}",
      ].join("\n"),
      loader: "js",
    }));
    // the real logger writes log files into the data folder (a SuperCargo folder): keep the test folders clean
    build.onResolve({ filter: /^\.\/logger$/ }, () => ({
      path: "logger",
      namespace: "logger-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "logger-stub" }, () => ({
      contents: `const put = (level) => (cat, msg, fields) => globalThis.__scLog.push({ level, cat, msg, fields }); export const logger = { debug: put('debug'), info: put('info'), warn: put('warn'), error: put('error') }`,
      loader: "js",
    }));
  },
};
const entry = path.join(tmp, "entry.ts");
const imp = (f) => JSON.stringify(path.join(root, f).split(path.sep).join("/"));
fs.writeFileSync(
  entry,
  `export * from ${imp("src/main/paths.ts")};\nexport * as DC from ${imp("src/main/dataCheck.ts")};\nexport * as DF from ${imp("src/main/dataFolderIpc.ts")};\n`,
);
const outfile = path.join(tmp, "paths.mjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
  tsconfig: path.join(root, "tsconfig.node.json"),
  plugins: [electronStub],
  alias: {
    "@shared": path.join(root, "src/shared"),
    "@other": path.join(root, "src/other"),
  },
});
const P = await import(pathToFileURL(outfile).href);
const verbose = process.argv.includes("--verbose");

const results = [];
const check = (name, what, ok, detail = "") =>
  results.push({ name, what, ok: !!ok, detail });
const safe = (name, fn) => {
  try {
    fn();
  } catch (e) {
    check(name, "threw", false, e?.stack ?? String(e));
  }
};
const same = (a, b) => path.resolve(a) === path.resolve(b);
const J = (x) => JSON.stringify(x);
const def = path.join(home, "SuperCargo-OtherModes");

safe("defaultDataFolder", () => {
  check(
    "constants",
    "DATA_FOLDER_NAME 'SuperCargo-OtherModes'",
    P.DATA_FOLDER_NAME === "SuperCargo-OtherModes",
  );
  check(
    "defaultDataFolder",
    "<home>/SuperCargo-OtherModes",
    same(P.defaultDataFolder(), def),
    P.defaultDataFolder(),
  );
});

safe("no override", () => {
  P.setDataFolderOverride(null);
  check(
    "dataFolder",
    "default when no override",
    same(P.dataFolder(), def),
    P.dataFolder(),
  );
  check("dataFolder", "default folder created", fs.existsSync(def));
  const s = P.dataFolderStatus();
  check(
    "dataFolderStatus",
    "isDefault, no fallback",
    s.isDefault === true && !("fallback" in s) && same(s.folder, def),
    J(s),
  );
  check(
    "settingsFile",
    "<default>/settings.json",
    same(P.settingsFile(), path.join(def, "settings.json")),
    P.settingsFile(),
  );
});

safe("missing override", () => {
  // a chosen folder that no longer exists (drive unplugged, folder deleted) is never recreated empty
  const gone = path.join(tmp, "unplugged", "SuperCargo-OtherModes");
  P.setDataFolderOverride(gone);
  const s = P.dataFolderStatus();
  check(
    "dataFolder",
    "missing override: default folder, reason 'folder not found', not created",
    s.isDefault && /folder not found/.test(s.fallback ?? "") && !fs.existsSync(gone),
    JSON.stringify(s),
  );
});

safe("writable override", () => {
  const other = path.join(tmp, "elsewhere", "My Data");
  fs.mkdirSync(other, { recursive: true }); // CHANGE creates it; at start-up it must already exist
  P.setDataFolderOverride(other);
  check(
    "dataFolder",
    "uses writable override (existing)",
    same(P.dataFolder(), other) && fs.existsSync(other),
    P.dataFolder(),
  );
  const s = P.dataFolderStatus();
  check(
    "dataFolderStatus",
    "not default, no fallback",
    s.isDefault === false && !s.fallback && same(s.folder, other),
    J(s),
  );
  check(
    "settingsFile",
    "still in the default folder with an override",
    same(P.settingsFile(), path.join(def, "settings.json")),
    P.settingsFile(),
  );
  const f = P.dataPath("logs", "deep", "supercargo.log");
  check(
    "dataPath",
    "joins under the override",
    same(f, path.join(other, "logs", "deep", "supercargo.log")),
    f,
  );
  check(
    "dataPath",
    "parent dirs created",
    fs.statSync(path.dirname(f)).isDirectory(),
  );
  check("dataPath", "file itself not created", !fs.existsSync(f));
  P.setDataFolderOverride("   ");
  check(
    "setDataFolderOverride",
    "blank string = no override",
    same(P.dataFolder(), def),
    P.dataFolder(),
  );
});

safe("override equal to default", () => {
  P.setDataFolderOverride(def + path.sep);
  const s = P.dataFolderStatus();
  check(
    "dataFolderStatus",
    "override = default counts as default",
    s.isDefault === true && !s.fallback,
    J(s),
  );
});

safe("uncreatable override", () => {
  const blocker = path.join(tmp, "a-file.txt");
  fs.writeFileSync(blocker, "x");
  const bad = path.join(blocker, "sub"); // parent is a file: mkdir fails (ENOTDIR / EEXIST)
  P.setDataFolderOverride(bad);
  check(
    "dataFolder",
    "uncreatable override falls back to default",
    same(P.dataFolder(), def),
    P.dataFolder(),
  );
  const s = P.dataFolderStatus();
  check(
    "dataFolderStatus",
    "isDefault with a fallback reason",
    s.isDefault === true &&
      typeof s.fallback === "string" &&
      s.fallback.length > 0,
    J(s),
  );
  check(
    "dataFolderStatus",
    "reason names the chosen folder",
    (s.fallback ?? "").includes(bad),
    s.fallback,
  );
  check(
    "dataPath",
    "falls back too",
    same(P.dataPath("history.json"), path.join(def, "history.json")),
  );
  check(
    "settingsFile",
    "unchanged by a bad override",
    same(P.settingsFile(), path.join(def, "settings.json")),
  );
});

safe("unwritable override", () => {
  const ro = path.join(tmp, "read-only");
  fs.mkdirSync(ro);
  fs.chmodSync(ro, 0o555);
  let writable = true;
  try {
    fs.accessSync(ro, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  P.setDataFolderOverride(ro);
  const s = P.dataFolderStatus();
  if (writable) {
    // root / Windows ignore the mode bits: the folder really is writable, so it must be used.
    check(
      "dataFolder",
      "read-only mode ignored by this OS/user: override used",
      same(s.folder, ro) && !s.fallback,
      J(s),
    );
  } else {
    check(
      "dataFolder",
      "unwritable override falls back to default with a reason",
      same(s.folder, def) && s.isDefault && !!s.fallback,
      J(s),
    );
  }
  fs.chmodSync(ro, 0o755);
});

safe("reset", () => {
  P.setDataFolderOverride(path.join(tmp, "a-file.txt", "sub"));
  P.dataFolder();
  fs.mkdirSync(path.join(tmp, "good"), { recursive: true });
  P.setDataFolderOverride(path.join(tmp, "good"));
  const g = P.dataFolderStatus();
  check(
    "setDataFolderOverride",
    "new override re-evaluated, old fallback cleared",
    same(g.folder, path.join(tmp, "good")) && !g.fallback,
    J(g),
  );
  P.setDataFolderOverride(null);
  const s = P.dataFolderStatus();
  check(
    "setDataFolderOverride",
    "null resets to default, no fallback",
    same(s.folder, def) && s.isDefault && !s.fallback,
    J(s),
  );
});

safe("cachePath", () => {
  P.setDataFolderOverride(path.join(tmp, "good"));
  const c = P.cachePath("tessdata", "eng.traineddata");
  check(
    "cachePath",
    "under the Electron userData stub",
    same(c, path.join(userData, "tessdata", "eng.traineddata")),
    c,
  );
  check(
    "cachePath",
    "not in the data folder",
    !path.resolve(c).startsWith(path.resolve(P.dataFolder()) + path.sep),
    c,
  );
  check(
    "cachePath",
    "root = userData",
    same(P.cachePath(), userData),
    P.cachePath(),
  );
  P.setDataFolderOverride(null);
});

safe("no stray userData", () => {
  const pathsTs = path.resolve(root, "src/main/paths.ts");
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") walk(p);
      } else if (
        /\.(ts|tsx|js|mjs|cjs)$/.test(ent.name) &&
        path.resolve(p) !== pathsTs
      ) {
        const lines = fs.readFileSync(p, "utf8").split("\n");
        lines.forEach((l, i) => {
          if (/getPath\(\s*['"`]userData['"`]\s*\)/.test(l))
            hits.push(`${path.relative(root, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(path.join(root, "src"));
  check(
    "src scan",
    "no getPath('userData') outside src/main/paths.ts",
    hits.length === 0,
    hits.join(", "),
  );
});

// ---- SuperCargo files, damaged-data check, Moved for Repair, CHANGE flow, start-up check ----
const { DC, DF } = P;
const W = (dir, rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const fresh = (name) => {
  const d = path.join(tmp, "dc", name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const safeA = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, "threw", false, e?.stack ?? String(e));
  }
};
const WHEN = new Date(2026, 9, 14, 21, 5); // local 2026-10-14 21:05
const STAMP = "2026-10-14 21-05";

safe("holdsData", () => {
  const d = fresh("holds");
  check("holdsData", "empty folder: no", DC.holdsData(d) === false);
  W(d, "settings.json", "{}");
  W(d, "notes.txt", "mine");
  fs.mkdirSync(path.join(d, "Moved for Repair"));
  check(
    "holdsData",
    "settings.json, other files and Moved for Repair don't count",
    DC.holdsData(d) === false,
  );
  const names = [
    ...DC.DATA_FILES,
    ...DC.DATA_DIRS,
    "uex-vehicles.json",
    "uex-anything.json",
    "other-jobs.corrupt-2026-10-14T21-05-00-000Z.json",
    "history.json.tmp",
  ];
  const missing = names.filter((n) => !DC.isDataEntry(n));
  check("holdsData", "every SuperCargo name counts", missing.length === 0, missing.join(", "));
  for (const n of ["manifest.json", "history.json", "window-state.json", "other-jobs.json", "other-matches.json",
    "other-bodies.json", "other-uex-places.json", "reference-data-status.json", "upload-queue.json", "game-data",
    "logs", "ocr-samples", "other-ocr-session", "outbox", "exports"]) {
    check("holdsData", `list has ${n}`, DC.isDataEntry(n));
  }
  check("holdsData", "settings.json never one of them", !DC.isDataEntry("settings.json"));
  fs.mkdirSync(path.join(d, "logs"));
  check("holdsData", "a SuperCargo folder counts", DC.holdsData(d) === true);
});

safe("checkDataFolder", () => {
  const good = fresh("good");
  W(good, "history.json", J({ entries: [] }));
  W(good, "manifest.json", J({ runId: "r", contracts: [], order: [] }));
  W(good, "other-jobs.json", J({ jobs: [], history: [] }));
  W(good, "uex-vehicles.json", J({ ships: [], syncedAt: "" }));
  W(good, "settings.json", "not json at all");
  W(good, "notes.json", "not json either"); // not a SuperCargo file
  const g = DC.checkDataFolder(good);
  check("checkDataFolder", "good data: hasData, no problems (settings.json and other files ignored)",
    g.hasData === true && g.problems.length === 0 && same(g.folder, good), J(g));
  const empty = DC.checkDataFolder(fresh("none"));
  check("checkDataFolder", "no data: hasData false", empty.hasData === false && empty.problems.length === 0, J(empty));

  const bad = fresh("bad");
  W(bad, "history.json", "{ entries: [");
  W(bad, "manifest.json", J({ contracts: 5 }));
  W(bad, "other-jobs.json", J([1, 2]));
  W(bad, "uex-locations.json", J({ syncedAt: "" }));
  W(bad, "other-matches.json", "");
  W(bad, "window-state.json", J({ width: 800, height: 600, maximized: false }));
  const b = DC.checkDataFolder(bad);
  const why = Object.fromEntries(b.problems.map((p) => [p.file, p.reason]));
  check("checkDataFolder", "damaged JSON", why["history.json"] === "not valid JSON", J(why));
  check("checkDataFolder", "bad shape: list field not a list", why["manifest.json"] === '"contracts" is not a list', J(why));
  check("checkDataFolder", "bad shape: not an object", why["other-jobs.json"] === "not in the expected layout", J(why));
  check("checkDataFolder", "bad shape: cache without its list", why["uex-locations.json"] === 'no "locations" list', J(why));
  check("checkDataFolder", "empty file", why["other-matches.json"] === "empty", J(why));
  check("checkDataFolder", "good file in a damaged folder not listed", !("window-state.json" in why) && b.problems.length === 5, J(why));
});

safe("moveForRepair", () => {
  const d = fresh("move");
  W(d, "history.json", "{ broken");
  W(d, "logs/supercargo.log", "line");
  W(d, "game-data/sub/x.json", "{}");
  W(d, "uex-vehicles.json", J({ ships: [] }));
  W(d, "settings.json", J({ a: 1 }));
  W(d, "notes.txt", "mine");
  const to = DC.moveForRepair(d, WHEN);
  check("moveForRepair", "returns <dir>/Moved for Repair/<YYYY-MM-DD HH-MM>", same(to, path.join(d, "Moved for Repair", STAMP)), to);
  check("moveForRepair", "files moved, folder structure kept",
    fs.existsSync(path.join(to, "history.json")) && fs.existsSync(path.join(to, "logs", "supercargo.log")) &&
      fs.existsSync(path.join(to, "game-data", "sub", "x.json")) && fs.existsSync(path.join(to, "uex-vehicles.json")));
  check("moveForRepair", "nothing SuperCargo left in the root", !DC.holdsData(d), fs.readdirSync(d).join(", "));
  check("moveForRepair", "settings.json stays", fs.existsSync(path.join(d, "settings.json")) && !fs.existsSync(path.join(to, "settings.json")));
  check("moveForRepair", "other files stay", fs.existsSync(path.join(d, "notes.txt")) && !fs.existsSync(path.join(to, "notes.txt")));
  W(d, "history.json", "{ broken again");
  const to2 = DC.moveForRepair(d, WHEN);
  check("moveForRepair", 'name clash: " (2)"', same(to2, path.join(d, "Moved for Repair", `${STAMP} (2)`)) && fs.existsSync(path.join(to2, "history.json")), to2);
  W(d, "history.json", "{ and again");
  const to3 = DC.moveForRepair(d, WHEN);
  check("moveForRepair", 'next clash: " (3)"', same(to3, path.join(d, "Moved for Repair", `${STAMP} (3)`)), to3);
  check("moveForRepair", "earlier move untouched", fs.existsSync(path.join(to, "logs", "supercargo.log")));
  check("moveForRepair", "logs what moved", globalThis.__scLog.some((e) => e.msg === "data moved for repair" && e.fields?.moved?.includes("history.json")));
  const second = fs.readdirSync(path.join(d, "Moved for Repair"));
  check("moveForRepair", "Moved for Repair itself never moved", second.length === 3, second.join(", "));
});

safe("switchTo", () => {
  const cur = fresh("current");
  W(cur, "history.json", J({ entries: [{ runId: "r1" }] }));
  W(cur, "other-jobs.json", J({ jobs: [], history: [] }));
  W(cur, "logs/supercargo.log", "line");
  W(cur, "notes.txt", "not ours");
  W(cur, "Moved for Repair/old/history.json", "{");
  P.setDataFolderOverride(cur);
  const saved = [];
  const deps = { getSettings: () => ({}), updateSettings: (p) => saved.push(p), getMainWindow: () => null };

  check("switchTo", "no subfolder helper any more", !("targetFor" in DF));
  const empty = fresh("picked-empty");
  const r = DF.switchTo(empty, deps);
  check("switchTo", "empty folder: used as is, data copied", r.ok && r.copied === 3 && !r.usedExisting &&
    fs.existsSync(path.join(empty, "history.json")) && fs.existsSync(path.join(empty, "logs", "supercargo.log")), J(r));
  check("switchTo", "picked folder saved as is", saved.length === 1 && same(saved[0].dataFolder, empty), J(saved));
  check("switchTo", "pending restart for that folder", same(r.info.pending ?? "", empty), J(r.info));
  check("switchTo", "settings.json, Moved for Repair and other files not copied",
    !fs.existsSync(path.join(empty, "notes.txt")) && !fs.existsSync(path.join(empty, "Moved for Repair")) &&
      !fs.existsSync(path.join(empty, "settings.json")), fs.readdirSync(empty).join(", "));

  const goodT = fresh("picked-good");
  W(goodT, "history.json", J({ entries: [] }));
  const r2 = DF.switchTo(goodT, deps);
  check("switchTo", "folder with good data: used as is, nothing copied", r2.ok && r2.usedExisting === true && r2.copied === 0 &&
    !fs.existsSync(path.join(goodT, "other-jobs.json")) && same(saved.at(-1).dataFolder, goodT), J(r2));

  const badT = fresh("picked-bad");
  W(badT, "history.json", "{ nope");
  W(badT, "other-bodies.json", J({ bodies: {} }));
  W(badT, "settings.json", J({ x: 1 }));
  const before = saved.length;
  const r3 = DF.switchTo(badT, deps);
  check("switchTo", "damaged data: needsRepair, not ok, nothing saved",
    !r3.ok && r3.needsRepair && r3.needsRepair.problems.length === 1 && r3.needsRepair.problems[0].file === "history.json" &&
      same(r3.needsRepair.folder, badT) && saved.length === before && !r3.error, J(r3));
  check("switchTo", "damaged data: nothing moved or copied yet",
    fs.readFileSync(path.join(badT, "history.json"), "utf8") === "{ nope" && !fs.existsSync(path.join(badT, "other-jobs.json")));

  const other = fresh("not-offered");
  W(other, "history.json", "{");
  const r4 = DF.repairTo(other, deps, WHEN);
  check("repairTo", "refuses a folder that wasn't offered", !r4.ok && !!r4.error && fs.existsSync(path.join(other, "history.json")), J(r4));

  const r5 = DF.repairTo(badT, deps, WHEN);
  const movedTo = path.join(badT, "Moved for Repair", STAMP);
  check("repairTo", "ok, movedTo, copies the current data in", r5.ok && same(r5.movedTo ?? "", movedTo) && r5.copied === 3, J(r5));
  check("repairTo", "old files moved, structure kept",
    fs.readFileSync(path.join(movedTo, "history.json"), "utf8") === "{ nope" && fs.existsSync(path.join(movedTo, "other-bodies.json")));
  check("repairTo", "current data now in the folder",
    J(JSON.parse(fs.readFileSync(path.join(badT, "history.json"), "utf8"))) === J({ entries: [{ runId: "r1" }] }));
  check("repairTo", "settings.json stays", fs.existsSync(path.join(badT, "settings.json")) && !fs.existsSync(path.join(movedTo, "settings.json")));
  check("repairTo", "saved + pending", same(saved.at(-1).dataFolder, badT) && same(r5.info.pending ?? "", badT), J(saved.at(-1)));
  const r6 = DF.repairTo(badT, deps, WHEN);
  check("repairTo", "only once per offer", !r6.ok, J(r6));
  P.setDataFolderOverride(null);
});

await safeA("startupDataCheck", async () => {
  P.setDataFolderOverride(null);
  for (const n of fs.readdirSync(def)) if (n !== "settings.json") fs.rmSync(path.join(def, n), { recursive: true, force: true });
  W(def, "settings.json", J({ keep: true }));
  W(def, "history.json", J({ entries: [] }));
  globalThis.__scDialog.calls = [];
  const ok = await DC.startupDataCheck();
  check("startupDataCheck", "good data: ok, no dialog", ok === "ok" && globalThis.__scDialog.calls.length === 0, ok);

  W(def, "history.json", "{ broken");
  W(def, "logs/supercargo.log", "line");
  globalThis.__scDialog.response = 1;
  const q = await DC.startupDataCheck();
  const o = globalThis.__scDialog.calls[0] ?? {};
  check("startupDataCheck", "Quit -> 'quit', nothing moved", q === "quit" && fs.existsSync(path.join(def, "history.json")) &&
    !fs.existsSync(path.join(def, "Moved for Repair")), q);
  check("startupDataCheck", "dialog: warning, title, buttons, default and cancel = Quit",
    o.type === "warning" && o.title === "SuperCargo data can't be read" && J(o.buttons) === J(["Reset and continue", "Quit"]) &&
      o.defaultId === 1 && o.cancelId === 1, J(o));
  check("startupDataCheck", "dialog lists the file with its reason", /history\.json: not valid JSON/.test(o.message ?? ""), o.message);
  check("startupDataCheck", "detail names the folder, Moved for Repair, settings kept",
    (o.detail ?? "").includes(def) && /Moved for Repair\\<date>/.test(o.detail ?? "") && /settings are kept/.test(o.detail ?? "") &&
      /starts with empty data/.test(o.detail ?? ""), o.detail);

  globalThis.__scDialog.response = 0;
  const rs = await DC.startupDataCheck();
  const moved = fs.existsSync(path.join(def, "Moved for Repair")) ? fs.readdirSync(path.join(def, "Moved for Repair")) : [];
  check("startupDataCheck", "Reset -> 'reset', files moved, settings.json kept", rs === "reset" && moved.length === 1 &&
    !DC.holdsData(def) && fs.existsSync(path.join(def, "Moved for Repair", moved[0], "logs", "supercargo.log")) &&
    J(JSON.parse(fs.readFileSync(path.join(def, "settings.json"), "utf8"))) === J({ keep: true }), `${rs} ${moved}`);
  const again = await DC.startupDataCheck();
  check("startupDataCheck", "after reset the folder reads fine", again === "ok", again);
});

fs.rmSync(tmp, { recursive: true, force: true });
let failed = 0;
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++;
  if (!ok || verbose)
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${what}  (${detail})`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
