// live debug window (#debug): no store, talks to main only through the debug API
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { C, F, GLOW } from '../theme'
import { Btn } from '../components/ui'
import CrashGuard from '../components/CrashGuard'
import { formatEntry, LOG_CATEGORIES, LOG_LEVELS } from '@shared/debugLog'
import { diagResultLine } from '@shared/trace'
import type { DebugInfo, LogCategory, LogEntry, LogLevel, LogSource } from '@shared/debugLog'

const MAX_ROWS = 5000
const SOURCES: LogSource[] = ['proc', 'main', 'overlay', 'debug']
const LEVEL_LABEL: Record<LogLevel, string> = { error: 'ERR', warn: 'WARN', info: 'INFO', debug: 'DEBUG' }
const LEVEL_COLOR: Record<LogLevel, string> = { error: C.red, warn: C.amber, info: C.textBody, debug: C.ghost }

interface Row {
  id: number
  e: LogEntry
  line: string
}

let seq = 0
const toRow = (e: LogEntry): Row => ({ id: seq++, e, line: formatEntry(e) })

function Chip({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: `1px solid ${on ? (color ?? C.accBorder) : C.line}`,
        background: on ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: on ? (color ?? C.acc) : C.ghost,
        fontFamily: F.display,
        fontSize: 11,
        letterSpacing: '0.12em',
        padding: '3px 9px',
        cursor: 'pointer',
        flex: 'none'
      }}
      hoverStyle={{ color: C.text }}
    >
      {children}
    </Btn>
  )
}

function ActBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'transparent',
        color: C.body,
        fontFamily: F.display,
        fontSize: 11,
        letterSpacing: '0.14em',
        padding: '6px 12px',
        cursor: 'pointer',
        flex: 'none'
      }}
      hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
    >
      {children}
    </Btn>
  )
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

const PERIODS: { id: string; label: string; hours?: number }[] = [
  { id: 'session', label: 'THIS GAME SESSION' },
  { id: '1', label: 'LAST 1 H', hours: 1 },
  { id: '6', label: 'LAST 6 H', hours: 6 },
  { id: '24', label: 'LAST 24 H', hours: 24 }
]

const NOTE_MAX = 2000
const IMAGES_LABEL = "Include images (OCR crops and an overlay picture). Pictures can't be cleaned of names."

function DiagExportBar(): React.ReactElement {
  const [period, setPeriod] = useState('session')
  const [excerpt, setExcerpt] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [includeImages, setIncludeImages] = useState(false)

  const run = async (): Promise<void> => {
    if (busy) return
    setAsking(false)
    setBusy(true)
    setImages([])
    setMsg({ text: 'saving…', err: false })
    try {
      const hours = PERIODS.find((p) => p.id === period)?.hours
      const opts = { hours, includeLogExcerpt: excerpt, note: note.trim() || undefined, includeImages }
      const r = await window.supercargo.diagExport(opts)
      if (r.ok) {
        setMsg({ text: diagResultLine(r), err: false })
        setImages(r.images ?? [])
        setNote('')
      } else setMsg({ text: r.error || 'export failed', err: true })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), err: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 14px' }}>
        <ActBtn onClick={() => { if (!busy) setAsking(true) }}>{busy ? 'SAVING…' : 'EXPORT DIAGNOSTICS'}</ActBtn>
        {PERIODS.map((p) => (
          <Chip key={p.id} on={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Chip>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: F.mono, fontSize: 11, color: C.body, cursor: 'pointer', marginLeft: 6 }}>
          <input type="checkbox" checked={excerpt} onChange={(e) => setExcerpt(e.target.checked)} />
          include log excerpt
        </label>
        <span style={{ flex: '1 1 200px', fontFamily: F.mono, fontSize: 11, color: msg?.err ? C.red : msg ? C.acc : C.ghost, wordBreak: 'break-all' }}>
          {msg?.text ?? 'Everything Claude needs to review the program; player names and ids are removed.'}
        </span>
      </div>
      {images.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 14px 8px' }}>
          {images.map((p) => (
            <span key={p} style={{ fontFamily: F.mono, fontSize: 11, color: C.acc, wordBreak: 'break-all' }}>
              image {p}
            </span>
          ))}
        </div>
      )}
      {asking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 14px 10px', maxWidth: 720 }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.dim }}>What went wrong? (optional)</span>
          <textarea
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            autoFocus
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="What you did, what you expected, what happened"
            style={{
              fontFamily: F.mono, fontSize: 11, color: C.text, background: 'rgba(0,0,0,0.35)',
              border: `1px solid ${C.line}`, padding: 6, resize: 'vertical'
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: F.mono, fontSize: 11, color: C.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
            {IMAGES_LABEL}
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <ActBtn onClick={() => void run()}>EXPORT</ActBtn>
            <ActBtn onClick={() => setAsking(false)}>CANCEL</ActBtn>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DebugPage(): React.ReactElement {
  return (
    <CrashGuard>
      <DebugView />
    </CrashGuard>
  )
}

function DebugView(): React.ReactElement {
  const [rows, setRows] = useState<Row[]>([])
  const [info, setInfo] = useState<DebugInfo | null>(null)
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(LOG_LEVELS))
  const [cats, setCats] = useState<Set<LogCategory>>(() => new Set(LOG_CATEGORIES))
  const [srcs, setSrcs] = useState<Set<LogSource>>(() => new Set(SOURCES))
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [flash, setFlash] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const refreshInfo = useCallback(() => {
    window.supercargo
      .debugInfo()
      .then(setInfo)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    document.title = 'SuperCargo Debug'
    refreshInfo()
    const iv = setInterval(refreshInfo, 2000)
    return () => clearInterval(iv)
  }, [refreshInfo])

  // live entries are buffered and applied at most every 200 ms
  useEffect(() => {
    let pending: Row[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    // lines that arrived live before history loaded; history skips them
    let early: Set<string> | null = new Set()
    const apply = (): void => {
      timer = null
      if (!pending.length) return
      const add = pending
      pending = []
      setRows((prev) => {
        const next = prev.concat(add)
        return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next
      })
    }
    // subscribe before loading history so nothing falls in the gap
    const off = window.supercargo.onDebugEntries((entries) => {
      for (const e of entries) {
        const r = toRow(e)
        early?.add(r.line)
        pending.push(r)
      }
      if (!timer) timer = setTimeout(apply, 200)
    })
    window.supercargo
      .debugRecent()
      .then((recent) => {
        if (!alive) return
        const seen = early ?? new Set<string>()
        early = null
        const hist = recent.map(toRow).filter((r) => !seen.has(r.line))
        setRows((prev) => {
          const next = hist.concat(prev)
          return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next
        })
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        levels.has(r.e.level) &&
        cats.has(r.e.cat) &&
        (srcs.has(r.e.src) || !SOURCES.includes(r.e.src)) &&
        (!q || r.line.toLowerCase().includes(q))
    )
  }, [rows, levels, cats, srcs, query])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && !paused && stick.current) el.scrollTop = el.scrollHeight
  }, [visible, paused])

  const onScroll = (): void => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const note = (msg: string): void => {
    setFlash(msg)
    setTimeout(() => setFlash(''), 1800)
  }

  const copy = async (text: string, msg: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      note(msg)
    } catch {
      note('copy failed')
    }
  }

  const copyReport = async (): Promise<void> => {
    try {
      await copy(await window.supercargo.debugReport(), 'report copied')
    } catch {
      note('report failed')
    }
  }

  const setVerbose = (on: boolean): void => {
    void window.supercargo
      .debugSetVerbose(on)
      .then(refreshInfo)
      .catch(() => undefined)
  }

  const label: React.CSSProperties = { color: C.ghost, marginRight: 5 }
  const verbose = info?.verbose ?? false

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0b0d0f', color: C.textBody }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 18px',
          padding: '10px 14px',
          borderBottom: `1px solid ${C.lineStrong}`,
          fontFamily: F.mono,
          fontSize: 12,
          color: C.body
        }}
      >
        <span style={{ fontFamily: F.display, letterSpacing: '0.2em', color: C.acc, textShadow: GLOW }}>DEBUG</span>
        {info ? (
          <>
            <span><span style={label}>ver</span>v{info.version}</span>
            <span><span style={label}>build</span>{info.commit}@{info.branch}</span>
            <span><span style={label}>mode</span>{info.workMode}</span>
            <span title={info.gameLogPath}>
              <span style={label}>Game.log</span>
              <span style={{ color: info.watcherConnected ? C.green : C.red }}>{info.watcherConnected ? 'connected' : 'not connected'}</span>{' '}
              {info.gameLogPath || '-'}
            </span>
            <span><span style={label}>verbose</span><span style={{ color: verbose ? C.acc : C.body }}>{verbose ? 'on' : 'off'}</span></span>
          </>
        ) : (
          <span style={{ color: C.ghost }}>loading…</span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 14px', borderBottom: `1px solid ${C.line}` }}>
        {LOG_LEVELS.slice()
          .reverse()
          .map((l) => (
            <Chip key={l} on={levels.has(l)} color={LEVEL_COLOR[l]} onClick={() => setLevels((s) => toggle(s, l))}>
              {LEVEL_LABEL[l]}
            </Chip>
          ))}
        <span style={{ width: 10 }} />
        {LOG_CATEGORIES.map((c) => (
          <Chip key={c} on={cats.has(c)} onClick={() => setCats((s) => toggle(s, c))}>
            {c}
          </Chip>
        ))}
        <span style={{ width: 10 }} />
        {SOURCES.map((s) => (
          <Chip key={s} on={srcs.has(s)} color={C.purple} onClick={() => setSrcs((p) => toggle(p, s))}>
            {s}
          </Chip>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search"
          spellCheck={false}
          style={{
            flex: '1 1 160px',
            minWidth: 120,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${C.line}`,
            color: C.text,
            fontFamily: F.mono,
            fontSize: 12,
            padding: '4px 8px',
            outline: 'none'
          }}
        />
        <Chip on={paused} color={C.amber} onClick={() => setPaused((p) => !p)}>
          {paused ? 'PAUSED' : 'PAUSE'}
        </Chip>
        <Chip on={verbose} onClick={() => setVerbose(!verbose)}>
          VERBOSE
        </Chip>
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 14px', fontFamily: F.mono, fontSize: 12, lineHeight: 1.5 }}
      >
        {visible.map((r) => (
          <div key={r.id} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: LEVEL_COLOR[r.e.level] }}>
            {r.line}
          </div>
        ))}
        {!visible.length && <div style={{ color: C.ghost, padding: '12px 0' }}>no entries</div>}
      </div>

      <DiagExportBar />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: `1px solid ${C.lineStrong}` }}>
        <ActBtn onClick={() => void copyReport()}>COPY REPORT</ActBtn>
        <ActBtn onClick={() => void copy(visible.map((r) => r.line).join('\n'), `${visible.length} lines copied`)}>COPY VISIBLE</ActBtn>
        <ActBtn onClick={() => void window.supercargo.debugOpenFolder().catch(() => undefined)}>OPEN LOG FOLDER</ActBtn>
        <ActBtn onClick={() => setRows([])}>CLEAR VIEW</ActBtn>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: F.mono, fontSize: 11, color: flash ? C.acc : C.ghost }}>
          {flash || `${visible.length} / ${rows.length} rows`}
        </span>
      </div>
    </div>
  )
}
