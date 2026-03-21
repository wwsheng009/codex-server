import { useEffect, useMemo } from 'react'

import { buildComposerAutocompleteSections } from './threadPageComposerShared'
import type {
  ComposerAutocompleteItem,
  ComposerCommandDefinition,
  ComposerCommandMenu,
} from './threadPageComposerShared'
import type { CatalogItem } from '../../types/api'

export function useThreadComposerAutocomplete({
  activeComposerMode,
  commandDefinitions,
  commandMenu,
  composerAutocompleteIndex,
  isCommandAutocompleteOpen,
  isMentionAutocompleteOpen,
  isSkillAutocompleteOpen,
  mentionFiles,
  query,
  setComposerAutocompleteIndex,
  skills,
}: {
  activeComposerMode?: 'command' | 'mention' | 'skill'
  commandDefinitions: ComposerCommandDefinition[]
  commandMenu: ComposerCommandMenu
  composerAutocompleteIndex: number
  isCommandAutocompleteOpen: boolean
  isMentionAutocompleteOpen: boolean
  isSkillAutocompleteOpen: boolean
  mentionFiles: Array<{ path: string; name: string; directory: string }>
  query: string
  setComposerAutocompleteIndex: (value: number | ((current: number) => number)) => void
  skills: CatalogItem[]
}) {
  const composerAutocompleteSections = useMemo(() => {
    if (isCommandAutocompleteOpen) {
      return buildComposerAutocompleteSections({
        mode: 'command',
        commands: commandDefinitions,
        commandMenu,
        query: activeComposerMode === 'command' ? query : '',
        skills,
        files: [],
      })
    }

    if (isSkillAutocompleteOpen) {
      return buildComposerAutocompleteSections({
        mode: 'skill',
        commands: [],
        commandMenu: 'root',
        query: activeComposerMode === 'skill' ? query : '',
        skills,
        files: [],
      })
    }

    if (isMentionAutocompleteOpen) {
      return buildComposerAutocompleteSections({
        mode: 'mention',
        commands: [],
        commandMenu: 'root',
        query: '',
        skills: [],
        files: mentionFiles,
      })
    }

    return []
  }, [
    activeComposerMode,
    commandDefinitions,
    commandMenu,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    mentionFiles,
    query,
    skills,
  ])

  const composerAutocompleteItems = useMemo(
    () => composerAutocompleteSections.flatMap((section) => section.items),
    [composerAutocompleteSections],
  )

  const composerAutocompleteSectionGroups = useMemo(() => {
    let offset = 0

    return composerAutocompleteSections.map((section) => {
      const indexedItems = section.items.map((item) => {
        const indexedItem = { item, index: offset }
        offset += 1
        return indexedItem
      })

      return {
        ...section,
        indexedItems,
      }
    })
  }, [composerAutocompleteSections])

  const composerAutocompleteItem: ComposerAutocompleteItem | null =
    composerAutocompleteItems[
      Math.max(0, Math.min(composerAutocompleteIndex, composerAutocompleteItems.length - 1))
    ] ?? null

  useEffect(() => {
    if (composerAutocompleteIndex < composerAutocompleteItems.length) {
      return
    }

    setComposerAutocompleteIndex(0)
  }, [composerAutocompleteIndex, composerAutocompleteItems.length, setComposerAutocompleteIndex])

  return {
    composerAutocompleteItem,
    composerAutocompleteItems,
    composerAutocompleteSectionGroups,
  }
}
