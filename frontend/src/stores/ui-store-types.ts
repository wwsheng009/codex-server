export type WorkspaceRestartPhase = 'restarting' | 'restarted'
export type ToastTone = 'info' | 'success' | 'error' | 'warning'

export type UIToast = {
  id: string
  title: string
  message: string
  tone: ToastTone
  durationMs: number
  actionLabel?: string
  onAction?: () => void
}

export type UIToastInput = {
  actionLabel?: string
  durationMs?: number
  id?: string
  message: string
  onAction?: () => void
  title: string
  tone: ToastTone
}

export type MobileThreadChromeInput = {
  activityRunning: boolean
  activityVisible: boolean
  refreshBusy: boolean
  statusLabel: string
  statusTone: string
  syncLabel: string
  syncTitle: string
  title: string
  visible: boolean
}

export type UIState = {
  utilityPanelOpen: boolean
  workspaceRestartStateById: Record<string, WorkspaceRestartPhase>
  toasts: UIToast[]
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
  pushToast: (toast: UIToastInput) => void
  dismissToast: (toastId: string) => void
  markWorkspaceRestarting: (workspaceId: string) => void
  markWorkspaceRestarted: (workspaceId: string) => void
  clearWorkspaceRestartState: (workspaceId: string) => void
  setMobileThreadChrome: (input: MobileThreadChromeInput) => void
  setMobileThreadToolsOpen: (open: boolean) => void
  resetMobileThreadChrome: () => void
}
