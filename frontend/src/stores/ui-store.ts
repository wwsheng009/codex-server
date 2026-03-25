import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { UIState } from './ui-store-types'
export type {
  MobileThreadChromeInput,
  UIToast,
  UIToastInput,
} from './ui-store-types'

const workspaceRestartTimers = new Map<string, ReturnType<typeof setTimeout>>()
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearWorkspaceRestartTimer(workspaceId: string) {
  const timer = workspaceRestartTimers.get(workspaceId)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  workspaceRestartTimers.delete(workspaceId)
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      utilityPanelOpen: false,
      workspaceRestartStateById: {},
      toasts: [],
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
      pushToast: ({ id, durationMs = 4000, ...toast }) => {
        const toastId = id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const dismiss = get().dismissToast
        const existingTimer = toastTimers.get(toastId)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }
        set((state) => ({
          toasts: [{ id: toastId, durationMs, ...toast }, ...state.toasts.filter((item) => item.id !== toastId)].slice(0, 4),
        }))
        const timer = setTimeout(() => {
          dismiss(toastId)
          toastTimers.delete(toastId)
        }, durationMs)
        toastTimers.set(toastId, timer)
      },
      dismissToast: (toastId) => {
        const timer = toastTimers.get(toastId)
        if (timer) {
          clearTimeout(timer)
          toastTimers.delete(toastId)
        }
        set((state) => ({
          toasts: state.toasts.filter((toast) => toast.id !== toastId),
        }))
      },
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
