/**
 * LEARNED DATA tab (Other mode only): what the app has learned from the game.
 * Places (match memory, editable), Sites and Planets (planet table, read-only).
 * Section headings match Settings → OTHER MODE.
 */
import React from 'react'
import { C, F } from '@renderer/theme'
import PageHeader, { PAGE_PADDING } from '@renderer/components/PageHeader'
import LearnedPlaces from '../components/LearnedPlaces'
import { LearnedPlanets, LearnedSites } from '../components/LearnedBodies'

const headingStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 20,
  fontWeight: 600,
  letterSpacing: '0.12em',
  color: C.acc,
  paddingBottom: 8,
  borderBottom: `2px solid ${C.accBorder}`,
  margin: '38px 0 0',
  scrollMarginTop: 12
}

const descStyle: React.CSSProperties = { fontFamily: F.body, fontSize: 13, color: C.dim, margin: '8px 0 4px' }

function Section({ id, title, desc, first = false, children }: {
  id: string
  title: string
  desc: string
  first?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section id={`learned-${id}`} data-testid={`learned-section-${id}`}>
      <h2 style={{ ...headingStyle, ...(first ? { marginTop: 18 } : null) }}>{title}</h2>
      <div style={descStyle}>{desc}</div>
      {children}
    </section>
  )
}

export default function LearnedDataPage(): React.ReactElement {
  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader title="LEARNED DATA" subtitle="What the app has learned from the game: places, sites and planets" />
      <Section
        id="places"
        first
        title="Places"
        desc="What each game place name means. Set by you, or learned when the game proved it. Fix one here or by clicking a match tag on a stop."
      >
        <LearnedPlaces />
      </Section>
      <Section id="sites" title="Sites" desc="Unnamed sites (such as a Security Compound) the app found near a known place. Read only.">
        <LearnedSites />
      </Section>
      <Section id="planets" title="Planets" desc="Planets and moons with their size: exact once read from the game panel, else estimated. Read only.">
        <LearnedPlanets />
      </Section>
    </div>
  )
}
