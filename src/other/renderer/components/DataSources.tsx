/**
 * Settings → DATA SOURCES: one row per place-data source with what it adds and an on/off switch.
 * UEX is the base list (always on). The Star Citizen Wiki game data (scunpacked-data: starmap positions +
 * site codes) can be switched off (otherSourceStarmap), which drops starmap-only places and starmap-filled
 * coordinates from the merged roster (otherPlaces.ts) and the game-data evidence from the resolver
 * (otherGameDataStore.ts); UPDATE downloads fresh copies (main/gameData.ts).
 */
import React, { useMemo } from 'react'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { otherSetting } from '../../workMode'
import { sourceCounts, useMergedLocations } from '../state/otherPlaces'
import { updateGameData, useGameData } from '../state/otherGameDataStore'

const hintStyle: React.CSSProperties = { display: 'block', fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }

export default function DataSources({
  rowStyle,
  keyStyle,
  Toggle
}: {
  rowStyle: React.CSSProperties
  keyStyle: React.CSSProperties
  Toggle: (props: { on: boolean; onClick: () => void }) => React.ReactElement
}): React.ReactElement {
  const haul = useStore((s) => s.locations)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  // re-renders when the Other places load or a switch flips
  const merged = useMergedLocations()
  const counts = useMemo(() => sourceCounts(haul ?? []), [haul, merged])
  const starmap = otherSetting(settings, 'otherSourceStarmap') !== false
  const { reply: game, updating } = useGameData()
  const when = game?.updatedAt ? new Date(game.updatedAt).toLocaleDateString() : ''
  const dataLine = game
    ? `${game.source === 'downloaded' ? 'Downloaded' : 'Bundled'}${when ? ` ${when}` : ''}: ${game.positions} starmap places, ${game.sites} site codes.`
    : ''
  const update = (): void => {
    dlog.info('other', 'game data update requested by user')
    void updateGameData()
  }

  const flip = (): void => {
    dlog.info('other', 'setting changed by user', { otherSourceStarmap: !starmap })
    void updateSettings({ otherSourceStarmap: !starmap })
  }

  return (
    <>
      <div style={rowStyle}>
        <span style={keyStyle}>
          UEX
          <span style={hintStyle}>
            {`${counts.uex.places} places, ${counts.uex.withCoords} with coordinates. Haul terminals plus UEX cities, stations and outposts.`}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} title="UEX is the base list and is always on">
          <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.08em', color: C.dim }}>BASE LIST</span>
          <div style={{ opacity: 0.45, pointerEvents: 'none' }} aria-disabled="true">
            <Toggle on onClick={() => undefined} />
          </div>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Star Citizen Wiki game data (scunpacked-data)
          <span style={hintStyle}>
            {`Starmap positions: adds ${counts.starmap.adds} places, fills coordinates for ${counts.starmap.fills}. Site codes: which places have a Security Compound, Storehouse, … Off: none of it is used for matching or distances.`}
          </span>
          {dataLine && <span style={hintStyle}>{dataLine}</span>}
          {game?.error && <span style={{ ...hintStyle, color: C.amber }}>{`Last update failed: ${game.error}`}</span>}
          <span style={hintStyle}>Game data is CIG's; fan use via the Star Citizen Wiki, not for resale.</span>
        </span>
        {/* switch first in the DOM (row-reverse puts it on the right): an accessible switch, found before UPDATE */}
        <div style={{ display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
          <div
            role="switch"
            aria-checked={starmap}
            aria-label="Star Citizen Wiki game data"
            tabIndex={0}
            onClick={flip}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                flip()
              }
            }}
          >
            <Toggle on={starmap} onClick={() => undefined} />
          </div>
          <button
            type="button"
            onClick={update}
            disabled={updating}
            title="Download the latest starmap positions and site codes from the Star Citizen Wiki (scunpacked-data)"
            style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.08em', padding: '3px 8px', cursor: updating ? 'default' : 'pointer', opacity: updating ? 0.5 : 1 }}
          >
            {updating ? 'UPDATING…' : 'UPDATE'}
          </button>
        </div>
      </div>
    </>
  )
}
