import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type UIState = {
  utilityPanelOpen: boolean
  setUtilityPanelOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      utilityPanelOpen: false,
      setUtilityPanelOpen: (open) => set({ utilityPanelOpen: open }),
    }),
    {
      name: 'codex-server-ui-store',
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
)
