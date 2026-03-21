import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type WorkspaceRestartPhase = 'restarting' | 'restarted'

const workspaceRestartTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearWorkspaceRestartTimer(workspaceId: string) {
  const timer = workspaceRestartTimers.get(workspaceId)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  workspaceRestartTimers.delete(workspaceId)
}

type UIState = {
  utilityPanelOpen: boolean
  workspaceRestartStateById: Record<string, WorkspaceRestartPhase>
  mobileThreadChromeVisible: boolean
  mobileThreadTitle: string
  mobileThreadStatusLabel: string
  mobileThreadStatusTone: string
  mobileThreadSyncLabel: string
  mobileThreadSyncTitle: string
  mobileThreadActivityVisible: boolean
  mobileThreadActivityRunning: boolean
  mobileThreadRefreshBusy: boolean
  mobileThreadToolsOpen: boolean
  setUtilityPanelOpen: (open: boolean) => void
  markWorkspaceRestarting: (workspaceId: string) => void
  markWorkspaceRestarted: (workspaceId: string) => void
  clearWorkspaceRestartState: (workspaceId: string) => void
  setMobileThreadChrome: (input: {
    visible: boolean
    title: string
    statusLabel: string
    statusTone: string
    syncLabel: string
    syncTitle: string
    activityVisible: boolean
    activityRunning: boolean
    refreshBusy: boolean
  }) => void
  setMobileThreadToolsOpen: (open: boolean) => void
  resetMobileThreadChrome: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      utilityPanelOpen: false,
      workspaceRestartStateById: {},
      mobileThreadChromeVisible: false,
      mobileThreadTitle: '',
      mobileThreadStatusLabel: '',
      mobileThreadStatusTone: 'idle',
      mobileThreadSyncLabel: '',
      mobileThreadSyncTitle: '',
      mobileThreadActivityVisible: false,
      mobileThreadActivityRunning: false,
      mobileThreadRefreshBusy: false,
      mobileThreadToolsOpen: false,
      setUtilityPanelOpen: (open) => set({ utilityPanelOpen: open }),
      markWorkspaceRestarting: (workspaceId) => {
        clearWorkspaceRestartTimer(workspaceId)
        set((state) => ({
          workspaceRestartStateById: {
            ...state.workspaceRestartStateById,
            [workspaceId]: 'restarting',
          },
        }))
      },
      markWorkspaceRestarted: (workspaceId) => {
        clearWorkspaceRestartTimer(workspaceId)
        set((state) => ({
          workspaceRestartStateById: {
            ...state.workspaceRestartStateById,
            [workspaceId]: 'restarted',
          },
        }))

        const timer = setTimeout(() => {
          set((state) => {
            if (!(workspaceId in state.workspaceRestartStateById)) {
              return state
            }

            const nextWorkspaceRestartStateById = { ...state.workspaceRestartStateById }
            delete nextWorkspaceRestartStateById[workspaceId]

            return {
              workspaceRestartStateById: nextWorkspaceRestartStateById,
            }
          })
          workspaceRestartTimers.delete(workspaceId)
        }, 2200)

        workspaceRestartTimers.set(workspaceId, timer)
      },
      clearWorkspaceRestartState: (workspaceId) => {
        clearWorkspaceRestartTimer(workspaceId)
        set((state) => {
          if (!(workspaceId in state.workspaceRestartStateById)) {
            return state
          }

          const nextWorkspaceRestartStateById = { ...state.workspaceRestartStateById }
          delete nextWorkspaceRestartStateById[workspaceId]

          return {
            workspaceRestartStateById: nextWorkspaceRestartStateById,
          }
        })
      },
      setMobileThreadChrome: ({
        visible,
        title,
        statusLabel,
        statusTone,
        syncLabel,
        syncTitle,
        activityVisible,
        activityRunning,
        refreshBusy,
      }) =>
        set({
          mobileThreadChromeVisible: visible,
          mobileThreadTitle: title,
          mobileThreadStatusLabel: statusLabel,
          mobileThreadStatusTone: statusTone,
          mobileThreadSyncLabel: syncLabel,
          mobileThreadSyncTitle: syncTitle,
          mobileThreadActivityVisible: activityVisible,
          mobileThreadActivityRunning: activityRunning,
          mobileThreadRefreshBusy: refreshBusy,
        }),
      setMobileThreadToolsOpen: (open) => set({ mobileThreadToolsOpen: open }),
      resetMobileThreadChrome: () =>
        set({
          mobileThreadChromeVisible: false,
          mobileThreadTitle: '',
          mobileThreadStatusLabel: '',
          mobileThreadStatusTone: 'idle',
          mobileThreadSyncLabel: '',
          mobileThreadSyncTitle: '',
          mobileThreadActivityVisible: false,
          mobileThreadActivityRunning: false,
          mobileThreadRefreshBusy: false,
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
