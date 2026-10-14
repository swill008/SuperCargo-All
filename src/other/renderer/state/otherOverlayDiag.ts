// What the overlay window last rendered, for the diagnostics export (## OVERLAY).
// The overlay publishes into this as it renders; the snapshot responder reads a copy.

let state: Record<string, unknown> = {}
let updatedAt = 0

export function setOverlayDiag(partial: Record<string, unknown>): void {
  state = { ...state, ...partial }
  updatedAt = Date.now()
}

export function overlayDiag(): Record<string, unknown> {
  return { ...state, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null }
}
