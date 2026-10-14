// render-crash boundary; the fallback must not touch the store
import React from 'react'
import { C, F, GLOW } from '../theme'
import { dlog } from '../state/log'

interface Props {
  children: React.ReactNode
  compact?: boolean
}

interface State {
  error: Error | null
  componentStack: string
  copied: boolean
}

const btn: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.22)',
  background: 'transparent',
  color: C.body,
  fontFamily: F.display,
  fontSize: 12,
  letterSpacing: '0.14em',
  padding: '7px 14px',
  cursor: 'pointer'
}

export default class CrashGuard extends React.Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info.componentStack ?? ''
    this.setState({ componentStack })
    try {
      dlog.error('ui', 'render crash', { message: error.message, stack: error.stack, componentStack })
    } catch {
      // logging must never break the fallback
    }
  }

  private copy = async (): Promise<void> => {
    const { error, componentStack } = this.state
    const head = [
      `CRASH: ${error?.message ?? 'unknown'}`,
      error?.stack ?? '',
      'Component stack:',
      componentStack.trim(),
      ''
    ].join('\n')
    let report = ''
    try {
      report = await window.supercargo.debugReport()
    } catch (e) {
      report = `(debug report unavailable: ${String(e)})`
    }
    try {
      await navigator.clipboard.writeText(`${head}\n${report}`)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch {
      // clipboard denied
    }
  }

  render(): React.ReactNode {
    const { error, componentStack, copied } = this.state
    if (!error) return this.props.children
    const compact = this.props.compact
    const frames = (error.stack ?? '').split('\n').slice(0, compact ? 4 : 8).join('\n')
    const pre: React.CSSProperties = {
      fontFamily: F.mono,
      fontSize: compact ? 10 : 12,
      color: C.dim,
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${C.line}`,
      padding: 10,
      margin: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'auto'
    }
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#0b0d0f',
          color: C.textBody,
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 8 : 12,
          padding: compact ? 12 : 28,
          overflow: 'hidden',
          border: `2px solid ${C.red}`,
          borderRadius: compact ? 10 : 18,
          zIndex: 99999
        }}
      >
        <div style={{ fontFamily: F.display, fontSize: compact ? 13 : 18, letterSpacing: '0.2em', color: C.red }}>
          SOMETHING BROKE
        </div>
        <div style={{ fontFamily: F.body, fontSize: compact ? 12 : 15, color: C.text }}>{error.message}</div>
        <pre style={{ ...pre, flex: 'none', maxHeight: compact ? 80 : 160 }}>{frames}</pre>
        {componentStack && (
          <pre style={{ ...pre, flex: 1, minHeight: 0 }}>{componentStack.trim()}</pre>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 'none' }}>
          <button style={{ ...btn, borderColor: C.accBorder, color: C.acc, textShadow: GLOW }} onClick={() => void this.copy()}>
            {copied ? 'COPIED' : 'COPY REPORT'}
          </button>
          <button style={btn} onClick={() => location.reload()}>
            RELOAD
          </button>
          <button style={btn} onClick={() => void window.supercargo.debugOpen().catch(() => undefined)}>
            OPEN DEBUG WINDOW
          </button>
        </div>
      </div>
    )
  }
}
