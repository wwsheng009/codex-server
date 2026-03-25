import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trans } from '@lingui/react'

import { getActiveLocale, i18n } from '../../i18n/runtime'
import type {
  CommandPaletteItem,
  CommandPaletteProps,
  RankedItem,
} from './commandPaletteTypes'

const groupOrder: Array<CommandPaletteItem['group']> = ['Action', 'Nav', 'Recent']

function getGroupLabel(group: CommandPaletteItem['group']) {
  switch (group) {
    case 'Action':
      return i18n._({ id: 'Action', message: 'Action' })
    case 'Nav':
      return i18n._({ id: 'Navigation', message: 'Navigation' })
    case 'Recent':
      return i18n._({ id: 'Recent', message: 'Recent' })
    default:
      return group
  }
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="m13.5 6.5-7 7M6.5 6.5l7 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

export function CommandPalette({
  isOpen,
  items,
  onClose,
  shortcutLabel,
}: CommandPaletteProps) {
  const inputId = useId()
  const listId = useId()
  const activeLocale = getActiveLocale()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const rankedItems = useMemo(() => {
    const normalizedQuery = normalizeText(query)
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean)

    return items
      .map((item) => {
        if (!tokens.length) {
          return {
            ...item,
            score: 0,
          } satisfies RankedItem
        }

        const searchTarget = normalizeText(
          [item.title, item.subtitle, item.group, item.keywords?.join(' ')].filter(Boolean).join(' '),
        )

        if (!tokens.every((token) => searchTarget.includes(token))) {
          return null
        }

        let score = 0

        if (normalizeText(item.title).startsWith(normalizedQuery)) {
          score += 80
        } else if (normalizeText(item.title).includes(normalizedQuery)) {
          score += 60
        }

        if (item.subtitle && normalizeText(item.subtitle).includes(normalizedQuery)) {
          score += 24
        }

        if (item.keywords?.some((keyword) => normalizeText(keyword).includes(normalizedQuery))) {
          score += 18
        }

        score += tokens.length * 4

        return {
          ...item,
          score,
        } satisfies RankedItem
      })
      .filter((item): item is RankedItem => item !== null)
      .sort((left, right) => {
        if (tokens.length && right.score !== left.score) {
          return right.score - left.score
        }

        if ((left.priority ?? 999) !== (right.priority ?? 999)) {
          return (left.priority ?? 999) - (right.priority ?? 999)
        }

        if (left.group !== right.group) {
          return groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group)
        }

        return left.title.localeCompare(right.title, activeLocale)
      })
  }, [activeLocale, items, query])

  const groupedItems = useMemo(
    () =>
      groupOrder
        .map((group) => ({
          group,
          items: rankedItems.filter((item) => item.group === group),
        }))
        .filter((entry) => entry.items.length),
    [rankedItems],
  )

  useEffect(() => {
    if (!isOpen) {
      previousFocusRef.current?.focus()
      return
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActiveIndex(0)

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setActiveIndex((current) => {
      if (!rankedItems.length) {
        return 0
      }

      return Math.min(current, rankedItems.length - 1)
    })
  }, [isOpen, rankedItems])

  if (!isOpen) {
    return null
  }

  const activeItem = rankedItems[activeIndex]

  function handleSelect(item: CommandPaletteItem) {
    onClose()
    item.onSelect()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (!rankedItems.length) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % rankedItems.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + rankedItems.length) % rankedItems.length)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      handleSelect(rankedItems[activeIndex])
    }
  }

  return createPortal(
    <>
      <button
        aria-label={i18n._({
          id: 'Close command palette',
          message: 'Close command palette',
        })}
        className="command-palette__backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="command-palette">
        <div
          aria-labelledby={inputId}
          aria-modal="true"
          className="command-palette__panel"
          role="dialog"
          >
            <div className="command-palette__header">
              <div className="command-palette__title-block">
                <strong>
                  <Trans id="Command Palette" message="Command Palette" />
                </strong>
                <span>
                  <Trans
                    id="Search navigation, actions, and recent context."
                    message="Search navigation, actions, and recent context."
                  />
                </span>
              </div>
              <div className="command-palette__header-actions">
                <span className="command-palette__shortcut">{shortcutLabel}</span>
                <button
                  aria-label={i18n._({ id: 'Close', message: 'Close' })}
                  className="command-palette__close-button"
                  onClick={onClose}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

          <div className="command-palette__search">
            <input
              aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded="true"
              className="command-palette__input"
              id={inputId}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={i18n._({
                id: 'Type a command or destination',
                message: 'Type a command or destination',
              })}
              ref={inputRef}
              role="combobox"
              spellCheck={false}
              value={query}
            />
          </div>

          <div className="command-palette__results" id={listId} role="listbox">
            {groupedItems.length ? (
              groupedItems.map((entry) => (
                <section className="command-palette__group" key={entry.group}>
                  <div className="command-palette__group-label">{getGroupLabel(entry.group)}</div>
                  <div className="command-palette__group-items">
                    {entry.items.map((item) => {
                      const itemIndex = rankedItems.findIndex((candidate) => candidate.id === item.id)
                      const isActive = itemIndex === activeIndex

                      return (
                        <button
                          aria-selected={isActive}
                          className={
                            isActive
                              ? 'command-palette__item command-palette__item--active'
                              : 'command-palette__item'
                          }
                          id={`${listId}-${item.id}`}
                          key={item.id}
                          onClick={() => handleSelect(item)}
                          onMouseEnter={() => setActiveIndex(itemIndex)}
                          role="option"
                          type="button"
                        >
                          <div className="command-palette__item-copy">
                            <strong>{item.title}</strong>
                            {item.subtitle ? <span>{item.subtitle}</span> : null}
                          </div>
                          {item.shortcut ? (
                            <span className="command-palette__item-shortcut">{item.shortcut}</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className="command-palette__empty">
                <strong>
                  <Trans
                    id="No matching commands"
                    message="No matching commands"
                  />
                </strong>
                <span>
                  <Trans
                    id="Try a page name, workspace, thread, or action keyword."
                    message="Try a page name, workspace, thread, or action keyword."
                  />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}
