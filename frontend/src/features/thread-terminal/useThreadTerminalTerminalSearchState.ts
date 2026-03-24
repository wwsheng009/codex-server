import { useEffect, useState } from 'react'

import type {
  ThreadTerminalSearchState,
  ThreadTerminalTerminalSearchStateInput
} from './threadTerminalInteractionStateTypes'

export function useThreadTerminalTerminalSearchState({
  activeSessionId,
  findNextInActiveViewport,
  findPreviousInActiveViewport,
  isLauncherOpen,
}: ThreadTerminalTerminalSearchStateInput): ThreadTerminalSearchState {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFeedback, setSearchFeedback] = useState<'idle' | 'not-found'>('idle')

  function focusSearchInput() {
    requestAnimationFrame(() => {
      const searchInput = document.querySelector<HTMLInputElement>('.terminal-dock__search input')
      searchInput?.focus()
      searchInput?.select()
    })
  }

  function handleOpenSearch() {
    if (isLauncherOpen || !activeSessionId) {
      return
    }

    setIsSearchOpen(true)
    focusSearchInput()
  }

  function handleToggleSearch() {
    if (isLauncherOpen || !activeSessionId) {
      return
    }

    setIsSearchOpen((current) => !current)
  }

  function handleCloseSearch() {
    setIsSearchOpen(false)
    setSearchQuery('')
    setSearchFeedback('idle')
  }

  function handleSearchQueryChange(value: string) {
    setSearchQuery(value)
    setSearchFeedback('idle')
  }

  function handleSearchNext() {
    const found = findNextInActiveViewport(searchQuery)
    setSearchFeedback(found ? 'idle' : 'not-found')
  }

  function handleSearchPrevious() {
    const found = findPreviousInActiveViewport(searchQuery)
    setSearchFeedback(found ? 'idle' : 'not-found')
  }

  useEffect(() => {
    if (isLauncherOpen) {
      setIsSearchOpen(false)
      setSearchQuery('')
      setSearchFeedback('idle')
    }
  }, [isLauncherOpen])

  return {
    close: handleCloseSearch,
    feedback: searchFeedback,
    isOpen: isSearchOpen,
    open: handleOpenSearch,
    query: searchQuery,
    searchNext: handleSearchNext,
    searchPrevious: handleSearchPrevious,
    setQuery: handleSearchQueryChange,
    toggle: handleToggleSearch,
  }
}
