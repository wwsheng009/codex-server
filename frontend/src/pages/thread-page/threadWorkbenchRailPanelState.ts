import { activateStoredTab } from '../../components/ui/Tabs'

export const THREAD_WORKBENCH_RAIL_PANEL_STORAGE_KEY =
  'codex-server:thread-workbench-rail-panel'

export const THREAD_WORKBENCH_RAIL_PANEL_IDS = {
  governance: 'governance',
  overview: 'overview',
  thread: 'thread',
  tools: 'tools',
} as const

export type ThreadWorkbenchRailPanelId =
  (typeof THREAD_WORKBENCH_RAIL_PANEL_IDS)[keyof typeof THREAD_WORKBENCH_RAIL_PANEL_IDS]

export function activateThreadWorkbenchRailPanel(panelId: ThreadWorkbenchRailPanelId) {
  activateStoredTab(THREAD_WORKBENCH_RAIL_PANEL_STORAGE_KEY, panelId)
}
