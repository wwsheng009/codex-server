import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type UIState = {
  utilityPanelOpen: boolean
  mobileThreadChromeVisible: boolean
  mobileThreadStatusLabel: string
  mobileThreadStatusTone: string
  mobileThreadToolsOpen: boolean
  setUtilityPanelOpen: (open: boolean) => void
  setMobileThreadChrome: (input: {
    visible: boolean
    statusLabel: string
    statusTone: string
  }) => void
  setMobileThreadToolsOpen: (open: boolean) => void
  resetMobileThreadChrome: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      utilityPanelOpen: false,
      mobileThreadChromeVisible: false,
      mobileThreadStatusLabel: '',
      mobileThreadStatusTone: 'idle',
      mobileThreadToolsOpen: false,
      setUtilityPanelOpen: (open) => set({ utilityPanelOpen: open }),
      setMobileThreadChrome: ({ visible, statusLabel, statusTone }) =>
        set({
          mobileThreadChromeVisible: visible,
          mobileThreadStatusLabel: statusLabel,
          mobileThreadStatusTone: statusTone,
        }),
      setMobileThreadToolsOpen: (open) => set({ mobileThreadToolsOpen: open }),
      resetMobileThreadChrome: () =>
        set({
          mobileThreadChromeVisible: false,
          mobileThreadStatusLabel: '',
          mobileThreadStatusTone: 'idle',
          mobileThreadToolsOpen: false,
        }),
    }),
    {
      name: 'codex-server-ui-store',
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        utilityPanelOpen: state.utilityPanelOpen,
      }),
    },
  ),
)
