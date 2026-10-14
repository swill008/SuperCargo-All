// Game data site-code checks: bundles src/other/otherSiteCodes.ts and checks the builders (parents,
// generic children, templates), the bundled data/uex/site-codes.json and the lookups (siteByCode,
// sitesNamed, parentForCode, codeFromText incl. panel-style codes), plus buildStarmapPlaces.
// Usage: node test/replay/sitecodes_checks.mjs   (no build needed)   --verbose prints every check
//        SC_TRADE_LOCATIONS=<file> / SC_STARMAP_POSITIONS=<file> also compare against raw scunpacked files

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sitecodes-'))
const outfile = path.join(tmp, 'otherSiteCodes.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherSiteCodes.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const M = await import(pathToFileURL(outfile).href)
const verbose = process.argv.includes('--verbose')

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'threw', false, e?.stack ?? String(e))
  }
}
const J = (x) => JSON.stringify(x)
const T = (code, name, extra = {}) => ({ ClassName: code, DisplayName: name, Disabled: false, ...extra })

// ---------------------------------------------------------------------------- builder (synthetic)
safe('build', () => {
  const doc = M.buildSiteCodes(
    [
      T('DC_X_Covalex_S1DC06', 'Covalex Distribution Center S1DC06'),
      T('DC_X_Covalex_S1DC06_FOB', 'Security Compound'),
      T('DC_X_Covalex_S1DC06_Storage', 'Storehouse'),
      T('DC_X_Covalex_S1DC06_Lobby', 'Lobby'),
      T('DC_X_Covalex_S1DC06_SecurityRoad', 'Covalex Distribution Center S1DC06'),
      T('DC_X_Covalex_S1DC06_Wing', null),
      T('DC_X_Covalex_S1DC06_Lobby_Desk', 'Front Desk'),
      T('Outpost_Tmpl', 'Remote Outpost near ~mission(NearbyLocation)'),
      T('Outpost_A', 'Windfall'),
      T('Outpost_B', 'Windfall'),
      T('Outpost_C', 'Windfall'),
      T('Outpost_C_SeersCanyon', "Seer's Canyon"),
      T('Outpost_C_SeersCanyon_Warehouse', 'Outpost Warehouse'),
      T('Old_Place', 'Gone Place', { Disabled: true }),
      T('lower_case', 'internal name'),
      { nope: 1 },
      null
    ],
    '2026-10-14T00:00:00.000Z'
  )
  const by = (c) => doc.sites.find((s) => s.code === c)
  check('build', 'generatedAt passed through', doc.generatedAt === '2026-10-14T00:00:00.000Z')
  check('build', 'place itself has no parent', by('DC_X_Covalex_S1DC06') && !by('DC_X_Covalex_S1DC06').parentCode, J(by('DC_X_Covalex_S1DC06')))
  check('build', 'FOB -> Security Compound at the DC', by('DC_X_Covalex_S1DC06_FOB')?.parentName === 'Covalex Distribution Center S1DC06', J(by('DC_X_Covalex_S1DC06_FOB')))
  check('build', 'Storehouse kept with its parent', by('DC_X_Covalex_S1DC06_Storage')?.parentCode === 'DC_X_Covalex_S1DC06')
  check('build', 'same-name child keeps the parent', by('DC_X_Covalex_S1DC06_SecurityRoad')?.parentCode === 'DC_X_Covalex_S1DC06')
  check('build', 'null DisplayName dropped', !by('DC_X_Covalex_S1DC06_Wing'))
  check('build', 'Lobby is never a parent (skips to the DC)', by('DC_X_Covalex_S1DC06_Lobby_Desk')?.parentCode === 'DC_X_Covalex_S1DC06', J(by('DC_X_Covalex_S1DC06_Lobby_Desk')))
  check('build', 'template (~mission) name dropped', !by('Outpost_Tmpl'))
  check('build', 'disabled entry dropped', !by('Old_Place'))
  check('build', 'all-lowercase internal name dropped', !by('lower_case'))
  check('build', 'template root (Windfall x3) is not a parent', !by('Outpost_C_SeersCanyon')?.parentCode, J(by('Outpost_C_SeersCanyon')))
  check('build', "generic child goes to Seer's Canyon, not Windfall", by('Outpost_C_SeersCanyon_Warehouse')?.parentName === "Seer's Canyon")
  check('build', 'sorted by code', J(doc.sites.map((s) => s.code)) === J([...doc.sites.map((s) => s.code)].sort((a, b) => a.localeCompare(b))))
  check('build', 'non-array input -> empty', M.buildSiteCodes({}).sites.length === 0)
})

// ---------------------------------------------------------------------------- normalize
safe('normalize', () => {
  check('normalize', 'wrong shape -> null', M.normalizeSiteCodesDoc({ x: 1 }) === null && M.normalizeSiteCodesDoc(null) === null)
  const n = M.normalizeSiteCodesDoc({ generatedAt: 'g', sites: [{ code: 'A', name: 'a A' }, { code: 1 }, { code: 'B', name: 'B', parentCode: 'A' }] })
  check('normalize', 'bad rows dropped', n.sites.length === 2, J(n))
  check('normalize', 'half a parent dropped', !n.sites[1].parentCode, J(n.sites[1]))
})

// ---------------------------------------------------------------------------- bundled file + lookups
const bundledPath = path.join(root, 'data/uex/site-codes.json')
const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'))
safe('bundled', () => {
  const doc = M.normalizeSiteCodesDoc(bundled)
  check('bundled', 'file has the expected shape', doc && doc.sites.length > 300 && typeof bundled.generatedAt === 'string', `sites=${doc?.sites.length}`)
  check('bundled', 'normalize keeps every row', doc.sites.length === bundled.sites.length)
  check('bundled', 'credit names the source', /scunpacked-data/.test(bundled.source ?? ''))
  check('bundled', 'every parent code exists in the table', bundled.sites.every((s) => !s.parentCode || bundled.sites.some((p) => p.code === s.parentCode)))
  check('bundled', 'no template names', bundled.sites.every((s) => !s.name.includes('~')))
  check('bundled', 'no parent is a generic name', bundled.sites.every((s) => !s.parentName || !/^(Security Compound|Storehouse|Lobby|Exterior Zone \d|Hangar \d+|Windfall)$/.test(s.parentName)))
  M.setSiteCodes(doc)
  check('bundled', 'siteCodesDoc is the set table', M.siteCodesDoc() === doc)
})

safe('lookups', () => {
  const DC = 'Covalex Distribution Center S1DC06'
  check('lookups', 'siteByCode exact', M.siteByCode('DC_Stan_Covalex_S1_S1DC06_FOB')?.name === 'Security Compound')
  check('lookups', 'siteByCode any case', M.siteByCode('dc_stan_covalex_s1_s1dc06_fob')?.code === 'DC_Stan_Covalex_S1_S1DC06_FOB')
  check('lookups', 'siteByCode unknown', M.siteByCode('Nope_Code') === undefined)
  const sc = M.sitesNamed('Security Compound')
  check('lookups', 'sitesNamed Security Compound has Covalex S1DC06', sc.some((p) => p.name === DC), J(sc.map((p) => p.name)))
  check('lookups', 'sitesNamed Security Compound has HDPC-Cassillo', sc.some((p) => p.name === 'HDPC-Cassillo'))
  check('lookups', 'sitesNamed is fold-insensitive', M.sitesNamed('the security compound').length === sc.length && M.sitesNamed('SECURITY COMPOUND').length === sc.length)
  check('lookups', 'sitesNamed lists each parent once', new Set(sc.map((p) => p.code)).size === sc.length)
  check('lookups', 'sitesNamed Storehouse', M.sitesNamed('Storehouse').some((p) => p.name === DC))
  check('lookups', 'sitesNamed of a place name itself -> none', M.sitesNamed(DC).length === 0, J(M.sitesNamed(DC)))
  check('lookups', 'sitesNamed unknown -> []', J(M.sitesNamed('Nowhere Special')) === '[]')
  check('lookups', 'parentForCode child', M.parentForCode('DC_Stan_Covalex_S1_S1DC06_FOB')?.name === DC)
  check('lookups', 'parentForCode place itself', M.parentForCode('DC_Stan_Covalex_S1_S1DC06')?.code === 'DC_Stan_Covalex_S1_S1DC06')
  check('lookups', 'parentForCode unknown', M.parentForCode('Nope_Code') === undefined)
  check('lookups', 'gameDataPlace knows a place', M.gameDataPlace('HDPC-Cassillo')?.code === 'DC_Stan_Hurston_S1_Cassillo')
  check('lookups', 'gameDataPlace folds Centre/Center', M.gameDataPlace('Covalex Distribution Centre S1DC06')?.name === DC)
  check('lookups', 'gameDataPlace: a generic name is not a place', M.gameDataPlace('Security Compound') === undefined)
  check('codes', 'stripCode removes the [CODE] part', M.stripCode('Security Compound [DC_Stan_Covalex_S1_S1DC06_FOB]') === 'Security Compound' && M.stripCode('Alpha  Station') === 'Alpha Station')
})

safe('codes', () => {
  check('codes', 'bracket code', M.codeFromText('Deliver to Security Compound [DC_Stan_Covalex_S1_S1DC06_FOB]') === 'DC_Stan_Covalex_S1_S1DC06_FOB')
  check('codes', 'bracket code, any case -> table spelling', M.codeFromText('[dc_stan_covalex_s1_s1dc06_fob]') === 'DC_Stan_Covalex_S1_S1DC06_FOB')
  check('codes', 'bare trade code', M.codeFromText('at DC_Stan_Covalex_S4_S4DC05_Storage now') === 'DC_Stan_Covalex_S4_S4DC05_Storage')
  const panel = M.codeFromText('Stanton1_DistributionCentre_Covalex_S1DC06')
  check('codes', 'panel style -> trade code', panel === 'DC_Stan_Covalex_S1_S1DC06', panel)
  const panel4 = M.codeFromText('Location: Stanton4_DistributionCentre_Covalex_S4DC05')
  check('codes', 'panel style S4DC05 not confused with S1DC06', panel4 === 'DC_Stan_Covalex_S4_S4DC05', panel4)
  check('codes', 'tradeCodeForPanel without a code token -> undefined', M.tradeCodeForPanel('Stanton1_Something_Else') === undefined)
  check('codes', 'unknown code returned as found', M.codeFromText('[Foo_Bar_Baz9]') === 'Foo_Bar_Baz9')
  check('codes', 'plain text -> undefined', M.codeFromText('Security Compound on Hurston') === undefined && M.codeFromText('') === undefined)
  check('codes', 'two-part words are not codes', M.codeFromText('drop_off here') === undefined)
})

// ---------------------------------------------------------------------------- code -> roster place (placeForCode)
safe('placeForCode', () => {
  const uex = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/locations.json'), 'utf8')).locations
  const pos = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
  const names = new Set(uex.map((l) => l.name))
  const L = [...uex, ...pos.filter((p) => !names.has(p.name))]
  const P = (c) => M.placeForCode(c, L)
  check('placeForCode', 'site child -> its parent on the roster', J(P('DC_Stan_Covalex_S1_S1DC06_FOB')) === J({ name: 'Covalex Distribution Centre S1DC06', via: 'site' }), J(P('DC_Stan_Covalex_S1_S1DC06_FOB')))
  check('placeForCode', 'panel style -> the place', P('Stanton1_DistributionCentre_Covalex_S1DC06')?.name === 'Covalex Distribution Centre S1DC06', J(P('Stanton1_DistributionCentre_Covalex_S1DC06')))
  check('placeForCode', 'RR_CRU_L1 -> CRU-L1 station', J(P('RR_CRU_L1')) === J({ name: 'CRU-L1 Ambitious Dream Station', via: 'lagrange' }), J(P('RR_CRU_L1')))
  check('placeForCode', 'rr_hur_leo (any case) -> Everus Harbor', P('rr_hur_leo')?.name === 'Everus Harbor', J(P('rr_hur_leo')))
  check('placeForCode', 'Stanton1_Lorville -> Lorville (city)', J(P('Stanton1_Lorville')) === J({ name: 'Lorville', via: 'city' }), J(P('Stanton1_Lorville')))
  check('placeForCode', 'Stanton2_Orison -> Orison', P('Stanton2_Orison')?.name === 'Orison', J(P('Stanton2_Orison')))
  check('placeForCode', 'unknown code -> null (never a guess)', P('Pyro_Nowhere') === null && P('RR_XYZ_L1') === null && P('') === null)
  check('placeForCode', 'roster without the place -> null', M.placeForCode('RR_CRU_L1', L.filter((l) => !/^CRU-L1/.test(l.name) && (l.code ?? '') !== 'CRU-L1')) === null)
  check('placeForCode', 'a Lagrange token alone is not a panel code (RR_XYZ_L1 is not a Pyro station)', M.tradeCodeForPanel('RR_XYZ_L1') === undefined, M.tradeCodeForPanel('RR_XYZ_L1'))
  check('placeForCode', 'generic site without a parent -> null', M.placeForCode('Nope_FOB', L) === null)
})

// ---------------------------------------------------------------------------- starmap places (synthetic)
safe('starmap', () => {
  const e = (uuid, name, type, parent, x = 1, extra = {}) => ({ uuid, name, type, system: 'stanton', parent_uuid: parent, x, y: 2, z: 3, ...extra })
  const doc = M.buildStarmapPlaces(
    {
      entities: [
        e('s', 'Stanton', 'Star', null),
        e('p', 'Hurston', 'Planet', 's'),
        e('m', 'Aberdeen', 'Moon', 'p'),
        e('o1', 'Deakins Research Outpost', 'Outpost', 'm'),
        e('o2', 'Twice', 'Outpost', 'p'),
        e('o3', 'Twice', 'Outpost', 'p', 5),
        e('o4', 'X Mission Location', 'PointOfInterest', 'p'),
        e('o5', 'internal', 'Outpost', 'p'),
        e('o6', 'No Coords', 'Outpost', 'p', 'x'),
        e('a', 'Rock', 'Asteroid', 's')
      ]
    },
    'g'
  )
  const names = doc.places.map((p) => p.name)
  check('starmap', 'keeps real places (planet, moon, outpost)', J(names) === J(['Aberdeen', 'Deakins Research Outpost', 'Hurston']), J(names))
  const d = doc.places.find((p) => p.name === 'Deakins Research Outpost')
  check('starmap', 'body = nearest planet/moon', d.body === 'Aberdeen')
  check('starmap', 'alias without "Outpost"', J(d.aliases) === J(['Deakins Research']))
  check('starmap', 'source + generatedAt', doc.source.includes('starmap_positions') && doc.generatedAt === 'g')
  check('starmap', 'bad input -> empty', M.buildStarmapPlaces(null).places.length === 0)
})

// ---------------------------------------------------------------------------- raw scunpacked files (optional)
const tradeFile = process.env.SC_TRADE_LOCATIONS
if (tradeFile && fs.existsSync(tradeFile)) {
  safe('raw', () => {
    const doc = M.buildSiteCodes(JSON.parse(fs.readFileSync(tradeFile, 'utf8')), bundled.generatedAt)
    check('raw', 'trade_locations rebuild equals the bundled file', J(doc.sites) === J(bundled.sites), `${doc.sites.length} vs ${bundled.sites.length}`)
  })
}
const starFile = process.env.SC_STARMAP_POSITIONS
if (starFile && fs.existsSync(starFile)) {
  safe('raw', () => {
    const doc = M.buildStarmapPlaces(JSON.parse(fs.readFileSync(starFile, 'utf8')))
    const old = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
    check('raw', 'starmap rebuild matches bundled other-positions.json', J(doc.places) === J(old), `${doc.places.length} vs ${old.length}`)
  })
}

fs.rmSync(tmp, { recursive: true, force: true })
const failed = results.filter((r) => !r.ok)
for (const r of results) if (verbose || !r.ok) console.log(`${r.ok ? 'ok  ' : 'FAIL'} [${r.name}] ${r.what}${r.ok ? '' : `  ${r.detail}`}`)
console.log(`sitecodes checks: ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
