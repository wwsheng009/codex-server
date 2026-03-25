import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { ComposerAutocompleteMode } from '../../lib/composer-autocomplete-types'
import type { SurfacePanelView } from '../../lib/layout-config-types'
import type { CatalogItem, Thread, ThreadDetail } from '../../types/api'
import type {
  ComposerAssistPanel,
  ComposerAutocompleteFileEntry,
  ComposerCommandDefinition,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'
import type { SurfacePanelSides, SurfacePanelWidths } from './workbenchLayoutTypes'

export type UsePendingThreadTurnsInput = {
  selectedThreadId?: string
  workspaceId: string
}

export type UseThreadPageSelectedThreadInput = {
  selectedThreadId?: string
  threadDetail?: ThreadDetail
  threads?: Thread[]
}

export type UseThreadPageSessionStateInput = {
  isDocumentVisible: boolean
  selectedProcessId?: string
  selectedThreadId?: string
  threadDetail?: ThreadDetail
  workspaceId: string
}

export type UseThreadPageRailStateInput = {
  isMobileViewport: boolean
  selectedThread?: Thread
  setIsInspectorExpanded: (value: boolean) => void
  setMobileThreadToolsOpen: (value: boolean) => void
  setSurfacePanelView: (value: SurfacePanelView | null) => void
}

export type BuildWorkbenchLayoutDerivedStateInput = {
  inspectorWidth: number
  isInspectorExpanded: boolean
  isMobileViewport: boolean
  surfacePanelSides: SurfacePanelSides
  surfacePanelView: SurfacePanelView | null
  surfacePanelWidths: SurfacePanelWidths
  terminalDockHeight: number
}

export type UseThreadPageQueriesInput = {
  composerFileSearchQuery: string
  hasPendingTurn: boolean
  isDocumentVisible: boolean
  selectedThreadId?: string
  streamState: string
  turnLimit: number
  workspaceId: string
}

export type UseThreadPagePanelQueriesInput = {
  activeComposerPanel: ComposerAssistPanel | null
  workspaceId: string
}

export type UseThreadPageDataInput = {
  activeComposerMatchMode?: ComposerAutocompleteMode
  activeComposerPanel: ComposerAssistPanel | null
  hasPendingTurn: boolean
  isDocumentVisible: boolean
  normalizedDeferredComposerQuery: string
  selectedProcessId?: string
  selectedThreadId?: string
  streamState: string
  threadTurnWindowSize: number
  workspaceId: string
}

export type UseThreadPageComposerCallbacksInput = {
  hasAccountError: boolean
  queryClient: QueryClient
  requiresOpenAIAuth: boolean
  sendError: string | null
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setComposerPreferences: Dispatch<SetStateAction<ComposerPreferences>>
  setSendError: (value: string | null) => void
  workspaceId: string
}

export type ComposerAutocompleteIndexSetter = (
  value: number | ((current: number) => number),
) => void

export type UseThreadComposerAutocompleteInput = {
  activeComposerMode?: ComposerAutocompleteMode
  commandDefinitions: ComposerCommandDefinition[]
  commandMenu: ComposerCommandMenu
  composerAutocompleteIndex: number
  isCommandAutocompleteOpen: boolean
  isMentionAutocompleteOpen: boolean
  isSkillAutocompleteOpen: boolean
  mentionFiles: ComposerAutocompleteFileEntry[]
  query: string
  setComposerAutocompleteIndex: ComposerAutocompleteIndexSetter
  skills: CatalogItem[]
}

export type UseThreadPageControllerRuntimeStateInput = {
  composerInputRef: RefObject<HTMLTextAreaElement | null>
  isMobileViewport: boolean
  selectedThreadId?: string
  workspaceId: string
}
