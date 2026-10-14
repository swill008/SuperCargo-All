import React, { useCallback, useEffect } from 'react'
import type { ReleaseNote, UpdateState } from '@shared/types'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import RefDataStatusPanel from './RefDataStatus'
import { RELEASE_PRODUCT, releaseLabel, releasePageUrl } from '@shared/release'

// Settings > CHECK FOR UPDATES, and the offer after a start-up check (like Gremlin's DialogUpdate).
export default function UpdateWindow(): React.ReactElement | null {
  const open = useStore((s) => s.updateWindowOpen)
  const update = useStore((s) => s.update)
  const appVersion = useStore((s) => s.appVersion)
  const closeWindow = useStore((s) => s.closeUpdateWindow)
  const checkForUpdates = useStore((s) => s.checkForUpdates)
  // like Gremlin: closing the window during a download cancels it (Update Now starts it again)
  // reads the state at the moment of closing, not the last render (an Esc right as the download starts must cancel it)
  const close = useCallback((): void => {
    if (useStore.getState().update?.kind === 'downloading') void window.supercargo.cancelUpdateDownload()
    closeWindow()
  }, [closeWindow])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const kind = update?.kind

  return (
    <div
      onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        role="dialog"
        aria-label="Check for Updates"
        data-testid="update-window"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(600px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', border: `1px solid ${C.accBorder}`, borderRadius: 8, background: '#0a0d10', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
      >
        <div style={{ padding: '14px 18px 10px', borderBottom: `1px solid ${C.lineSoft}`, flex: 'none' }}>
          <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em', color: C.acc }}>UPDATES</div>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>Check for Updates</div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 18px' }}>
          <div data-testid="update-message" style={{ fontFamily: F.body, fontSize: 14, color: C.text, lineHeight: 1.45 }}>
            {message(update, appVersion)}
          </div>

          {update?.kind === 'available' && <NotesBox notes={update.notes} url={update.url} />}
          {update?.kind === 'downloading' && <Progress percent={update.percent} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            {update?.kind === 'available' && !update.portable && (
              <Act main onClick={() => void window.supercargo.downloadUpdate()}>Update Now</Act>
            )}
            {update?.kind === 'available' && update.portable && (
              <ActLink main href={update.url}>Open Release Page</ActLink>
            )}
            {update?.kind === 'available' && (
              <Act
                onClick={() => {
                  void window.supercargo.skipUpdate(update.version)
                  close()
                }}
              >
                Skip This Version
              </Act>
            )}
            {update?.kind === 'ready' && (
              <Act main onClick={() => void window.supercargo.quitAndInstall()}>Install and Restart</Act>
            )}
            {update?.kind === 'error' && <Act onClick={() => void checkForUpdates()}>Try Again</Act>}
            {update?.kind === 'failed' && (
              <>
                <Act main onClick={() => void window.supercargo.downloadUpdate()}>Try Again</Act>
                <ActLink href={releasePageUrl(update.version)}>Open Release Page</ActLink>
              </>
            )}
            {kind === 'downloading' && <Act onClick={() => void window.supercargo.cancelUpdateDownload()}>Cancel</Act>}
            {kind !== 'downloading' && (
              <Act onClick={close}>{kind === 'available' || kind === 'ready' ? 'Later' : 'Close'}</Act>
            )}
          </div>
        </div>

        <div style={{ flex: 'none', borderTop: `1px solid ${C.lineSoft}`, padding: '12px 18px 16px' }}>
          <RefDataStatusPanel />
        </div>
      </div>
    </div>
  )
}

const MB = 1024 * 1024
const mb = (n: number): string => (n / MB).toFixed(1)

function message(u: UpdateState | null, cur: string): React.ReactNode {
  if (!u) return null
  switch (u.kind) {
    case 'checking':
      return 'Checking for updates…'
    case 'upToDate':
      return `${RELEASE_PRODUCT} ${releaseLabel(u.version || cur)} is up to date.`
    case 'available':
      return (
        <>
          <b>{releaseLabel(u.version)}</b> is available. You have {releaseLabel(cur)}.
        </>
      )
    case 'downloading':
      return u.total
        ? `Downloading… ${mb(u.transferred ?? 0)} / ${mb(u.total)} MB`
        : `Downloading… ${Math.round(u.percent)}%`
    case 'ready':
      return u.verified ? 'Downloaded and checked. Install and Restart to finish.' : 'Downloaded. Install and Restart to finish.'
    case 'error':
      return `Couldn't check for updates: ${u.message}`
    case 'failed':
      return `The download failed: ${u.message}`
  }
  return null
}

function NotesBox({ notes, url }: { notes: ReleaseNote[] | null; url: string }): React.ReactElement {
  const several = !!notes && notes.length > 1
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, background: 'rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column' }}>
      <div data-testid="release-notes" style={{ maxHeight: 280, overflowY: 'auto', padding: '8px 12px 4px' }}>
        {notes && notes.length ? (
          notes.map((n, i) => (
            <div key={n.version}>
              {i > 0 && <hr style={{ border: 'none', borderTop: `1px solid ${C.line}`, margin: '14px 0' }} />}
              {several && (
                <div style={{ fontFamily: F.body, fontSize: 12, color: C.ghost, marginTop: i === 0 ? 4 : 0, marginBottom: 2 }}>
                  What&apos;s new in {releaseLabel(n.version)}
                </div>
              )}
              <Markdown text={n.markdown} />
            </div>
          ))
        ) : (
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.ghost, padding: '2px 0 6px' }}>Release notes unavailable.</div>
        )}
      </div>
      <div style={{ padding: '4px 12px 8px' }}>
        <a href={url} target="_blank" rel="noreferrer" style={{ fontFamily: F.body, fontSize: 13, color: C.acc }}>
          Full release notes on GitHub ↗
        </a>
      </div>
    </div>
  )
}

// Small, safe markdown: "#…" headings, "- " bullets (indent nests), **bold**, `code`, [text](https://…).
// Everything is built as React elements; nothing from the release body runs as HTML.
function Markdown({ text }: { text: string }): React.ReactElement {
  const out: React.ReactNode[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) return
    const head = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (head) {
      out.push(
        <div key={i} style={{ fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', color: C.text, marginTop: 8, marginBottom: 2 }}>
          {inline(head[1])}
        </div>
      )
      return
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      const depth = Math.min(3, Math.floor(bullet[1].replace(/\t/g, '  ').length / 2))
      out.push(
        <div key={i} style={{ display: 'flex', gap: 7, marginLeft: 4 + depth * 14, marginBottom: 2, fontFamily: F.body, fontSize: 13, color: C.body, lineHeight: 1.4 }}>
          <span style={{ color: C.ghost, flex: 'none' }}>•</span>
          <span>{inline(bullet[2])}</span>
        </div>
      )
      return
    }
    out.push(
      <div key={i} style={{ fontFamily: F.body, fontSize: 13, color: C.body, lineHeight: 1.4, marginBottom: 4 }}>
        {inline(line.trim())}
      </div>
    )
  })
  return <>{out}</>
}

function inline(s: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index))
    const k = parts.length
    if (m[1] !== undefined) parts.push(<b key={k} style={{ color: C.text }}>{m[1]}</b>)
    else if (m[2] !== undefined) parts.push(<code key={k} style={{ fontFamily: F.mono, fontSize: 12 }}>{m[2]}</code>)
    else parts.push(<a key={k} href={m[4]} target="_blank" rel="noreferrer" style={{ color: C.acc }}>{m[3]}</a>)
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push(s.slice(last))
  return parts
}

function Progress({ percent }: { percent: number }): React.ReactElement {
  const p = Math.max(0, Math.min(100, percent || 0))
  return (
    <div data-testid="update-progress" style={{ height: 6, borderRadius: 3, background: C.lineSoft, overflow: 'hidden' }}>
      <div style={{ width: `${p}%`, height: '100%', background: C.acc, boxShadow: GLOW, transition: 'width 150ms linear' }} />
    </div>
  )
}

const actBase: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 13,
  letterSpacing: '0.06em',
  padding: '8px 14px',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block'
}
const actQuiet: React.CSSProperties = { ...actBase, border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim }
const actMain: React.CSSProperties = { ...actBase, fontWeight: 600, border: `1px solid ${C.acc}`, background: C.accFillStrong, color: C.text, textShadow: GLOW }

function Act({ main, onClick, children }: { main?: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={main ? actMain : actQuiet}
      hoverStyle={main ? { background: C.acc, color: C.black, textShadow: 'none' } : { color: C.text, border: `1px solid ${C.acc}` }}
    >
      {children}
    </Btn>
  )
}

// opens in the browser (the window's open handler sends target=_blank links out)
function ActLink({ main, href, children }: { main?: boolean; href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={main ? actMain : actQuiet}>
      {children}
    </a>
  )
}
