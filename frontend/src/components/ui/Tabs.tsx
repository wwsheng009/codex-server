import { useEffect, useId, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  TabItem,
  TabsActivateDetail,
  TabsProps,
} from './tabsTypes'

const TABS_ACTIVATE_EVENT = 'codex-server:tabs-activate'
const TAB_ID_SEPARATOR = '\u0000'

function buildTabIdsKey(items: TabItem[]) {
  return items.map((item) => item.id).join(TAB_ID_SEPARATOR)
}

function splitTabIdsKey(tabIdsKey: string) {
  return tabIdsKey ? tabIdsKey.split(TAB_ID_SEPARATOR) : []
}

function isValidTabId(tabIdsKey: string, tabId: string | null | undefined): tabId is string {
  if (!tabId) {
    return false
  }

  return splitTabIdsKey(tabIdsKey).includes(tabId)
}

function resolveInitialActiveId(tabIdsKey: string, defaultValue?: string, storageKey?: string) {
  const tabIds = splitTabIdsKey(tabIdsKey)
  const fallbackId = tabIds[0] ?? ''
  if (storageKey && typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(storageKey)
    if (isValidTabId(tabIdsKey, stored)) {
      return stored
    }
  }

  return isValidTabId(tabIdsKey, defaultValue) ? defaultValue : fallbackId
}

export function activateStoredTab(storageKey: string, tabId: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, tabId)
  window.dispatchEvent(
    new CustomEvent<TabsActivateDetail>(TABS_ACTIVATE_EVENT, {
      detail: { storageKey, tabId },
    }),
  )
}

export function Tabs({ items, ariaLabel, defaultValue, className = '', storageKey }: TabsProps) {
  const tabsId = useId()
  const tabIdsKey = buildTabIdsKey(items)
  const initialActiveId = resolveInitialActiveId(tabIdsKey, defaultValue, storageKey)
  const [activeId, setActiveId] = useState(() => initialActiveId)

  const activeIndex = useMemo(
    () => items.findIndex((item) => item.id === activeId),
    [activeId, items],
  )
  const activeItem = activeIndex >= 0 ? items[activeIndex] : items[0]
  const activeIdValid = isValidTabId(tabIdsKey, activeId)

  useEffect(() => {
    if (!items.length) {
      return
    }
    if (!activeIdValid && activeId !== initialActiveId) {
      setActiveId(initialActiveId)
    }
  }, [activeId, activeIdValid, initialActiveId, items.length])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined' || !activeItem) {
      return
    }
    window.localStorage.setItem(storageKey, activeItem.id)
  }, [activeItem, storageKey])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      return
    }

    const syncActiveId = (nextTabId: string | null | undefined) => {
      if (isValidTabId(tabIdsKey, nextTabId)) {
        setActiveId(nextTabId)
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) {
        return
      }
      syncActiveId(event.newValue)
    }

    const handleActivate = (event: Event) => {
      const detail = (event as CustomEvent<TabsActivateDetail>).detail
      if (!detail || detail.storageKey !== storageKey) {
        return
      }
      syncActiveId(detail.tabId)
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(TABS_ACTIVATE_EVENT, handleActivate)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(TABS_ACTIVATE_EVENT, handleActivate)
    }
  }, [storageKey, tabIdsKey])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!items.length) {
      return
    }

    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
      return
    }

    event.preventDefault()

    if (event.key === 'Home') {
      setActiveId(items[0].id)
      return
    }
    if (event.key === 'End') {
      setActiveId(items[items.length - 1].id)
      return
    }

    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (activeIndex + direction + items.length) % items.length
    setActiveId(items[nextIndex].id)
  }

  if (!items.length || !activeItem) {
    return null
  }

  const classes = ['ui-tabs', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div
        aria-label={ariaLabel}
        className="ui-tabs__list"
        onKeyDown={handleKeyDown}
        role="tablist"
      >
        {items.map((item) => {
          const selected = item.id === activeItem.id
          const tabId = `${tabsId}-${item.id}-tab`
          const panelId = `${tabsId}-${item.id}-panel`
          return (
            <button
              aria-controls={panelId}
              aria-selected={selected}
              className={selected ? 'ui-tabs__tab ui-tabs__tab--active' : 'ui-tabs__tab'}
              id={tabId}
              key={item.id}
              onClick={() => setActiveId(item.id)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {item.icon ? <span className="ui-tabs__icon">{item.icon}</span> : null}
              <span>{item.label}</span>
              {item.badge ? <span className="ui-tabs__badge">{item.badge}</span> : null}
            </button>
          )
        })}
      </div>
      <div
        aria-labelledby={`${tabsId}-${activeItem.id}-tab`}
        className="ui-tabs__panel"
        id={`${tabsId}-${activeItem.id}-panel`}
        role="tabpanel"
      >
        {activeItem.content}
      </div>
    </div>
  )
}
