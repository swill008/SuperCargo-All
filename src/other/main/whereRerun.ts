/**
 * WHERE AM I re-run after a trashed zone read (pure, no electron; batch 15 answer 6).
 * A contract job reaching the shared reader throws away a running zone job (ReaderTrashedError).
 * Manual run (button / hotkey / calibrate): wait until no contract job is running or queued, then run the whole run
 * again (fresh screenshot), at most WHERE_MAX_RERUNS re-runs; trashed once more after that = failed.
 * Live run: dropped silently (the caller doesn't broadcast or record it).
 */

export const WHERE_MAX_RERUNS = 5
export const WHERE_RERUN_POLL_MS = 100

export const TRASHED = Symbol('trashed')

export type RerunOutcome<T> =
  | { kind: 'done'; value: T; reruns: number }
  /** manual run trashed WHERE_MAX_RERUNS + 1 times */
  | { kind: 'failed'; reruns: number }
  /** live run trashed: drop it silently */
  | { kind: 'dropped'; reruns: 0 }

export interface RerunDeps<T> {
  /** one whole run; TRASHED when its zone read was thrown away for a contract job */
  attempt: () => Promise<T | typeof TRASHED>
  live: boolean
  contractPending: () => boolean
  sleep: (ms: number) => Promise<void>
  max?: number
  onRerun?: (n: number) => void
}

export async function runWithReruns<T>(d: RerunDeps<T>): Promise<RerunOutcome<T>> {
  const max = d.max ?? WHERE_MAX_RERUNS
  let reruns = 0
  for (;;) {
    const v = await d.attempt()
    if (v !== TRASHED) return { kind: 'done', value: v, reruns }
    if (d.live) return { kind: 'dropped', reruns: 0 }
    if (reruns >= max) return { kind: 'failed', reruns }
    while (d.contractPending()) await d.sleep(WHERE_RERUN_POLL_MS)
    reruns++
    d.onRerun?.(reruns)
  }
}
