/**
 * AFK button (main process): every interval bring the Star Citizen window to the front and press a key
 * (first key once, then the cycle key), until stopped, the time limit, the game window going away, or quit.
 * Keys go through a persistent PowerShell child running an Add-Type C# helper: SendInput with scan codes.
 * Test seam: env SC_AFK_DRYRUN=1 -> no PowerShell, presses are only recorded (any OS);
 * SC_AFK_INTERVAL_MS overrides the interval, honoured in dry run only.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { AppSettings } from '@shared/types'
import {
  AFK_MAX_FOCUS_FAILS,
  AFK_WHERE_DELAY_MS,
  afkConfig,
  afkNextKey,
  afkOff,
  afkPressed,
  afkScanCode,
  afkSkipped,
  afkStart,
  afkStopReason,
  afkStopped,
  afkWhereDue,
  type AfkConfig,
  type AfkState
} from '@other/otherAfk'
import { runWhere } from './whereAmI'
import { logger } from '../../main/logger'
import { trace } from '../../main/trace'

/**
 * Helper script, run with -File. Reads one command per line on stdin, answers one JSON line each:
 *   press <scan> <ext 0|1>  -> find the game window, bring it to the front, key down + up
 *                              {"ok":true,"found":true} | {"ok":false,"found":false} | {"ok":false,"found":true,"error":"..."}
 *   focus                   -> find + bring to the front only
 *   ping                    -> {"ok":true}
 *   quit                    -> exits
 * Param ExcludePid: our own app's process, never picked by the window-title fallback.
 */
export const AFK_HELPER_PS1 = String.raw`param([int]$ExcludePid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ScAfk {
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  // union sized by MOUSEINPUT, so INPUT is 40 bytes on x64 and 28 on x86
  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public InputUnion u; }

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_SCANCODE = 0x0008;
  const ushort VK_MENU = 0x12;
  const int SW_RESTORE = 9;

  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  public static IntPtr FindGame(int excludePid) {
    foreach (Process p in Process.GetProcessesByName("StarCitizen")) {
      try { if (p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle; } catch { }
    }
    IntPtr exact = IntPtr.Zero, partial = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (excludePid != 0 && pid == (uint)excludePid) return true;
      StringBuilder sb = new StringBuilder(256);
      GetWindowText(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t == "Star Citizen") { exact = h; return false; }
      if (partial == IntPtr.Zero && t.IndexOf("Star Citizen", StringComparison.OrdinalIgnoreCase) >= 0) partial = h;
      return true;
    }, IntPtr.Zero);
    return exact != IntPtr.Zero ? exact : partial;
  }

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; i.u.ki.time = 0; i.u.ki.dwExtraInfo = IntPtr.Zero;
    return i;
  }

  static uint Send(INPUT[] a) { return SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); }

  // true when hWnd is the foreground window afterwards
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
    if (GetForegroundWindow() == h) return true;
    uint dummy;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    try {
      // foreground-lock workaround: a synthetic ALT tap makes us the last input source
      Send(new INPUT[] { Key(VK_MENU, 0, 0), Key(VK_MENU, 0, KEYEVENTF_KEYUP) });
      BringWindowToTop(h);
      SetForegroundWindow(h);
    } finally {
      if (attached) AttachThreadInput(me, fgThread, false);
    }
    for (int n = 0; n < 15; n++) {
      if (GetForegroundWindow() == h) return true;
      Thread.Sleep(20);
    }
    return GetForegroundWindow() == h;
  }

  // key down, hold, key up, by scan code; "" when sent, else the error
  public static string Press(ushort scan, bool ext) {
    uint f = KEYEVENTF_SCANCODE | (ext ? KEYEVENTF_EXTENDEDKEY : 0);
    if (Send(new INPUT[] { Key(0, scan, f) }) != 1) return "SendInput down failed: " + Marshal.GetLastWin32Error();
    Thread.Sleep(60);
    if (Send(new INPUT[] { Key(0, scan, f | KEYEVENTF_KEYUP) }) != 1) return "SendInput up failed: " + Marshal.GetLastWin32Error();
    return "";
  }
}
'@

function Reply([string]$json) { [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
function Esc([string]$s) { return ($s -replace '\\', '\\' -replace '"', '\"' -replace "[\r\n]", ' ') }

Reply '{"ok":true,"ready":true}'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim() -split '\s+'
  try {
    switch ($parts[0]) {
      'ping' { Reply '{"ok":true}' }
      'quit' { Reply '{"ok":true}'; exit 0 }
      'focus' {
        $h = [ScAfk]::FindGame($ExcludePid)
        if ($h -eq [IntPtr]::Zero) { Reply '{"ok":false,"found":false}' }
        elseif ([ScAfk]::Focus($h)) { Reply '{"ok":true,"found":true}' }
        else { Reply '{"ok":false,"found":true,"error":"could not bring the game to the front"}' }
      }
      'press' {
        $h = [ScAfk]::FindGame($ExcludePid)
        if ($h -eq [IntPtr]::Zero) { Reply '{"ok":false,"found":false}' }
        elseif (-not [ScAfk]::Focus($h)) { Reply '{"ok":false,"found":true,"error":"could not bring the game to the front"}' }
        else {
          $err = [ScAfk]::Press([uint16]($parts[1]), ($parts[2] -eq '1'))
          if ($err -eq '') { Reply '{"ok":true,"found":true}' } else { Reply ('{"ok":false,"found":true,"error":"' + (Esc $err) + '"}') }
        }
      }
      default { Reply ('{"ok":false,"error":"unknown command ' + (Esc $parts[0]) + '"}') }
    }
  } catch {
    Reply ('{"ok":false,"error":"' + (Esc $_.Exception.Message) + '"}')
  }
}
`

export interface HelperReply {
  ok: boolean
  found?: boolean
  error?: string
  ready?: boolean
}

// ---- diagnostics (item 4) ----

export interface AfkPressDiag {
  at: string
  key: string
  scan?: number
  /** game window found (undefined = no reply / dry run) */
  found?: boolean
  /** helper brought the game to the front */
  focusOk?: boolean
  ok: boolean
  error?: string
  dryRun?: boolean
}

const PRESS_MAX = 50
const STDERR_MAX = 20
const pressLog: AfkPressDiag[] = []
const stderrLog: string[] = []
let helperStartupMs: number | null = null
let helperStarts = 0

function pushRing<T>(a: T[], v: T, max: number): void {
  a.push(v)
  if (a.length > max) a.splice(0, a.length - max)
}

function logPress(key: string, r: HelperReply | null): void {
  const sc = afkScanCode(key)
  pushRing(
    pressLog,
    {
      at: new Date().toISOString(),
      key,
      scan: sc?.scan,
      found: r?.found,
      // focus failed replies say so; a sent key means focus worked
      focusOk: r ? (r.ok ? true : r.found === true && /front/i.test(r.error ?? '') ? false : undefined) : undefined,
      ok: r ? r.ok : true,
      error: r?.error,
      ...(r ? {} : { dryRun: true })
    },
    PRESS_MAX
  )
}

const REPLY_TIMEOUT_MS = 8_000
const READY_TIMEOUT_MS = 20_000 // Add-Type compiles C# on first start

/** one persistent PowerShell child; commands answered in order */
class PsHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private waiting: { resolve: (r: HelperReply) => void; timer: ReturnType<typeof setTimeout> }[] = []
  private readyP: Promise<HelperReply> | null = null
  onExit: ((code: number | null) => void) | null = null

  get alive(): boolean {
    return !!this.child
  }

  private scriptFile(): string {
    const file = path.join(os.tmpdir(), 'supercargo-afk-helper.ps1')
    // BOM so Windows PowerShell 5.1 reads the file as UTF-8
    fs.writeFileSync(file, '﻿' + AFK_HELPER_PS1, 'utf8')
    return file
  }

  start(): Promise<HelperReply> {
    if (this.readyP) return this.readyP
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptFile(), '-ExcludePid', String(process.pid)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.child = child
    this.buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => this.onData(d))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      logger.warn('other', 'afk: helper stderr', { text: d.slice(0, 500) })
      for (const l of d.split(/\r?\n/)) if (l.trim()) pushRing(stderrLog, l.slice(0, 500), STDERR_MAX)
    })
    child.on('error', (e) => logger.error('other', 'afk: helper spawn error', { error: e.message }))
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.readyP = null
      for (const w of this.waiting.splice(0)) {
        clearTimeout(w.timer)
        w.resolve({ ok: false, error: 'helper exited' })
      }
      this.onExit?.(code)
    })
    helperStarts++
    const t0 = Date.now()
    this.readyP = this.wait(READY_TIMEOUT_MS).then((r) => {
      helperStartupMs = Date.now() - t0
      return r
    })
    return this.readyP
  }

  private onData(d: string): void {
    this.buf += d
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      let r: HelperReply
      try {
        r = JSON.parse(line) as HelperReply
      } catch {
        logger.warn('other', 'afk: helper sent non-JSON', { line: line.slice(0, 200) })
        continue
      }
      const w = this.waiting.shift()
      if (w) {
        clearTimeout(w.timer)
        w.resolve(r)
      }
    }
  }

  private wait(ms: number): Promise<HelperReply> {
    return new Promise((resolve) => {
      const entry = {
        resolve,
        timer: setTimeout(() => {
          const k = this.waiting.indexOf(entry)
          if (k >= 0) this.waiting.splice(k, 1)
          resolve({ ok: false, error: 'helper timed out' })
          this.kill() // replies would be out of step now
        }, ms)
      }
      this.waiting.push(entry)
    })
  }

  async send(cmd: string): Promise<HelperReply> {
    const ready = await this.start()
    if (!ready.ok || !this.child) return { ok: false, error: ready.error ?? 'helper not running' }
    const p = this.wait(REPLY_TIMEOUT_MS)
    this.child.stdin.write(cmd + '\n')
    return p
  }

  kill(): void {
    const c = this.child
    if (!c) return
    try {
      c.stdin.write('quit\n')
      c.stdin.end()
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      if (c.exitCode === null) c.kill()
    }, 1000)
  }
}

let state: AfkState = afkOff()
let getSettingsRef: (() => AppSettings) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let whereTimer: ReturnType<typeof setTimeout> | null = null
let lastWhereAt: number | null = null
let focusFails = 0
let restarts = 0
let helper: PsHelper | null = null
let ticking = false

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isDryRun(): boolean {
  return process.env.SC_AFK_DRYRUN === '1'
}

function config(): AfkConfig {
  const s = (getSettingsRef?.() ?? {}) as Parameters<typeof afkConfig>[0]
  const ms = isDryRun() ? Number(process.env.SC_AFK_INTERVAL_MS) : NaN
  return afkConfig(s, Number.isFinite(ms) && ms > 0 ? ms : undefined)
}

export function getAfkState(): AfkState {
  return { ...state, lastKeys: state.lastKeys?.slice() }
}

function broadcast(): void {
  const s = getAfkState()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.evtOtherAfk, s)
  }
}

function set(next: AfkState): void {
  state = next
  broadcast()
}

function clearTimers(): void {
  if (timer) clearTimeout(timer)
  if (whereTimer) clearTimeout(whereTimer)
  timer = null
  whereTimer = null
}

function finish(why: string, error?: string): AfkState {
  if (!state.on) return getAfkState()
  clearTimers()
  set(afkStopped(state, error))
  helper?.kill()
  helper = null
  logger.info('other', 'afk: stopped', { why, presses: state.presses, error })
  trace({ area: 'usage', mode: 'other', what: 'afk stopped', data: { why, presses: state.presses, error, dryRun: !!state.dryRun } })
  return getAfkState()
}

function getHelper(): PsHelper {
  if (helper) return helper
  const h = new PsHelper()
  h.onExit = (code) => {
    if (helper !== h) return
    helper = null
    if (!state.on) return
    logger.warn('other', 'afk: helper exited', { code, restarts })
    trace({ area: 'error', mode: 'other', what: 'afk helper exited', data: { code, restarts } })
  }
  helper = h
  return h
}

/** one key press via the helper; restarts a dead helper once per AFK run */
async function sendPress(key: string): Promise<HelperReply> {
  const sc = afkScanCode(key)
  if (!sc) return { ok: false, found: true, error: `unknown key ${key}` }
  const cmd = `press ${sc.scan} ${sc.ext ? 1 : 0}`
  let r = await getHelper().send(cmd)
  if (!r.ok && (r.error === 'helper exited' || r.error === 'helper timed out' || r.error === 'helper not running') && restarts < 1) {
    restarts++
    logger.warn('other', 'afk: restarting helper', { error: r.error })
    helper?.kill()
    helper = null
    r = await getHelper().send(cmd)
  }
  return r
}

function scheduleWhere(now: number, cfg: AfkConfig): void {
  if (!cfg.whereRead || !afkWhereDue(lastWhereAt, now) || whereTimer) return
  lastWhereAt = now
  whereTimer = setTimeout(() => {
    whereTimer = null
    if (!state.on) return
    void runWhere({ why: 'live' }).catch((e: unknown) => logger.warn('other', 'afk: where read failed', { error: errText(e) }))
  }, AFK_WHERE_DELAY_MS)
}

function scheduleNext(): void {
  if (!state.on || !state.nextAt) return
  const ms = Math.max(0, Date.parse(state.nextAt) - Date.now())
  timer = setTimeout(() => void tick(), ms)
}

/** one cycle: stop checks, focus + key, schedule the next */
async function tick(): Promise<void> {
  timer = null
  if (!state.on || ticking) return
  ticking = true
  try {
    const cfg = config()
    const stop = afkStopReason(state, Date.now())
    if (stop) {
      finish(stop)
      return
    }
    const key = afkNextKey(state, cfg)
    if (isDryRun()) {
      logPress(key, null)
      set(afkPressed(state, Date.now(), cfg, key))
      scheduleWhere(Date.now(), cfg)
      scheduleNext()
      return
    }
    let r: HelperReply
    try {
      r = await sendPress(key)
    } catch (e) {
      r = { ok: false, error: errText(e) }
    }
    logPress(key, r)
    if (!state.on) return // stopped while the press was in flight
    if (r.ok) {
      focusFails = 0
      set(afkPressed(state, Date.now(), cfg, key))
      scheduleWhere(Date.now(), cfg)
    } else if (r.found === false) {
      finish('game window gone', state.presses === 0 ? 'Star Citizen window not found' : 'Star Citizen window closed')
      return
    } else if (r.found === true && ++focusFails < AFK_MAX_FOCUS_FAILS) {
      logger.warn('other', 'afk: press skipped', { key, error: r.error, focusFails })
      set(afkSkipped(state, Date.now(), cfg, r.error ?? 'key not sent'))
    } else {
      logger.error('other', 'afk: key sending failed', { key, error: r.error })
      trace({ area: 'error', mode: 'other', what: 'afk key failed', data: { key, error: r.error } })
      finish('error', r.error ?? 'key not sent')
      return
    }
    scheduleNext()
  } finally {
    ticking = false
  }
}

/** start AFK; resolves after the first press (or the reason it could not) */
export async function startOtherAfk(): Promise<AfkState> {
  if (state.on) return getAfkState()
  const dry = isDryRun()
  if (!dry && process.platform !== 'win32') {
    state = { ...afkOff(), lastError: 'Windows only' }
    broadcast()
    return getAfkState()
  }
  const cfg = config()
  clearTimers()
  focusFails = 0
  restarts = 0
  lastWhereAt = null
  set(afkStart(Date.now(), cfg, dry))
  logger.info('other', 'afk: started', { intervalMs: cfg.intervalMs, firstKey: cfg.firstKey, cycleKey: cfg.cycleKey, maxMs: cfg.maxMs, dryRun: dry })
  trace({ area: 'usage', mode: 'other', what: 'afk started', data: { intervalMs: cfg.intervalMs, firstKey: cfg.firstKey, cycleKey: cfg.cycleKey, maxMs: cfg.maxMs, dryRun: dry } })
  await tick()
  return getAfkState()
}

/** stop AFK (button, quit); the game stays focused, no extra key */
export function stopOtherAfk(): AfkState {
  return finish('stopped')
}

let ipcDone = false

export function registerOtherAfkIpc(getSettings: () => AppSettings): void {
  getSettingsRef = getSettings
  if (ipcDone) return
  ipcDone = true
  ipcMain.handle(IPC.otherAfkStart, () => startOtherAfk())
  ipcMain.handle(IPC.otherAfkStop, () => stopOtherAfk())
  ipcMain.handle(IPC.otherAfkGet, () => getAfkState())
}

/** diagnostics: current state, last 50 presses, helper stderr (last 20 lines), start-up ms, restarts */
export function getAfkDiag(): {
  state: AfkState
  presses: AfkPressDiag[]
  stderr: string[]
  startupMs: number | null
  restarts: number
  helperStarts: number
  helperAlive: boolean
} {
  return {
    state: getAfkState(),
    presses: pressLog.map((p) => ({ ...p })),
    stderr: stderrLog.slice(),
    startupMs: helperStartupMs,
    restarts,
    helperStarts,
    helperAlive: !!helper?.alive
  }
}
