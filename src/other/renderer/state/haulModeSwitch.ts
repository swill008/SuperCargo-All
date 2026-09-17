/**
 * HAUL MODE AUTO LOGIC SWITCH
 * Feature tag: "Haul Mode Auto Logic Switch"
 *
 * Other mode hides Manifest / pack / route. A hauling accept still hits
 * stock SuperCargo (evtContractAccepted when isHauling). That contract is
 * already on the haul manifest. This file does not parse haul logs and
 * does not change store.ts.
 *
 * bindHaulModeSwitch() runs AFTER init() so Game.log replay will not prompt.
 * Stay: removeContract + dismissScanItem. Switch: workMode haul + Manifest.
 */
import { create } from 'zustand'
import { useStore } from '@renderer/state/store'
import type { ContractAcceptedEvent } from '@shared/types'

export type PendingHaulSwitch = {
  missionId: string
  title: string
}

interface HaulModeSwitchState {
  pending: PendingHaulSwitch[]
  offer: (e: ContractAcceptedEvent) => void
  stayInOther: () => void
  switchToHaul: () => void
}

let bound = false

export const useHaulModeSwitch = create<HaulModeSwitchState>((set, get) => ({
  pending: [],

  offer: (_e) => {
    /* Combined Other lists haul on Jobs. Prompt disabled; files kept for revert. */
  },

  stayInOther: () => {
    const pending = get().pending
    const store = useStore.getState()
    store.closeCapture()
    for (const p of pending) {
      store.removeContract(p.missionId)
      store.dismissScanItem(p.missionId)
    }
    set({ pending: [] })
  },

  switchToHaul: () => {
    const store = useStore.getState()
    void store.updateSettings({ workMode: 'haul' })
    store.setView('manifest')
    set({ pending: [] })
  }
}))

export function bindHaulModeSwitch(): void {
  if (bound) return
  bound = true
  if (!window.supercargo.onContractAccepted) return
  window.supercargo.onContractAccepted((e) => {
    useHaulModeSwitch.getState().offer(e)
  })
}
