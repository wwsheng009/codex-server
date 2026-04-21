import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  SelectControlProps,
  SelectMenuPosition,
  SelectOption,
} from './selectControlTypes'

function firstEnabledIndex(options: SelectOption[]) {
  return options.findIndex((option) => !option.disabled)
}

function lastEnabledIndex(options: SelectOption[]) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) {
      return index
    }
  }

  return -1
}

function stepEnabledIndex(options: SelectOption[], startIndex: number, direction: 1 | -1) {
  if (!options.length) {
    return -1
  }

  let index = startIndex
  for (let count = 0; count < options.length; count += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index]?.disabled) {
      return index
    }
  }

  return -1
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="m3.5 8.2 2.3 2.3 5-5.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function CaretIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="m4.5 6.5 3.5 3.8 3.5-3.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function SelectControl({
  value,
  options,
  onChange,
  ariaLabel,
  menuLabel,
  className = '',
  menuClassName = '',
  optionClassName = '',
  disabled = false,
  fullWidth = false,
}: SelectControlProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null
  const selectedOptionDisabled = selectedIndex >= 0 ? Boolean(options[selectedIndex]?.disabled) : false
  const firstEnabledOptionIndex = firstEnabledIndex(options)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    selectedIndex >= 0 && !selectedOptionDisabled ? selectedIndex : firstEnabledOptionIndex,
  )
  const [menuPosition, setMenuPosition] = useState<SelectMenuPosition | null>(null)

  const classes = [
    'custom-select',
    fullWidth ? 'custom-select--full' : '',
    isOpen ? 'custom-select--open' : '',
    disabled ? 'custom-select--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const selectedLabel = selectedOption?.triggerLabel ?? selectedOption?.label ?? ''

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const nextIndex = selectedIndex >= 0 && !selectedOptionDisabled ? selectedIndex : firstEnabledOptionIndex
    setHighlightedIndex(nextIndex)
  }, [firstEnabledOptionIndex, isOpen, selectedIndex, selectedOptionDisabled])

  useEffect(() => {
    if (!disabled) {
      return
    }

    setIsOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const highlightedOption = optionRefs.current[highlightedIndex]
    highlightedOption?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    menuRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const viewportPadding = 12
      const menuGap = 2
      const estimatedWidth = Math.min(
        Math.max(rect.width, 180),
        Math.max(180, window.innerWidth - viewportPadding * 2),
      )
      const menuWidth = menuRef.current?.offsetWidth ?? estimatedWidth
      const estimatedHeight = Math.min(options.length * 38 + (menuLabel ? 48 : 16), 280)
      const menuHeight = menuRef.current?.offsetHeight ?? estimatedHeight
      const openAbove =
        rect.bottom + menuGap + menuHeight > window.innerHeight - viewportPadding &&
        rect.top > window.innerHeight - rect.bottom
      const top = openAbove
        ? Math.max(viewportPadding, rect.top - menuHeight - menuGap)
        : Math.min(rect.bottom + menuGap, window.innerHeight - viewportPadding - menuHeight)
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - viewportPadding - menuWidth),
      )

      setMenuPosition({
        top,
        left,
        minWidth: rect.width,
        maxWidth: window.innerWidth - viewportPadding * 2,
        transformOrigin: openAbove ? 'bottom left' : 'top left',
      })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    function handleWindowChange() {
      updatePosition()
    }

    updatePosition()
    const frameId = window.requestAnimationFrame(updatePosition)
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [isOpen, menuLabel, options.length])

  function closeMenu(focusTrigger = false) {
    setIsOpen(false)
    if (focusTrigger) {
      window.requestAnimationFrame(() => {
        triggerRef.current?.focus()
      })
    }
  }

  function openMenu(preferredIndex?: number) {
    if (disabled) {
      return
    }

    const fallbackIndex = firstEnabledIndex(options)
    const nextIndex =
      preferredIndex !== undefined && preferredIndex >= 0 && !options[preferredIndex]?.disabled
        ? preferredIndex
        : fallbackIndex

    setHighlightedIndex(nextIndex)
    setIsOpen(true)
  }

  function commitSelection(index: number) {
    const option = options[index]
    if (!option || option.disabled) {
      return
    }

    onChange(option.value)
    closeMenu(true)
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (isOpen) {
          setHighlightedIndex((current) =>
            stepEnabledIndex(options, current >= 0 ? current : selectedIndex, 1),
          )
        } else {
          openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options))
        }
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (isOpen) {
          setHighlightedIndex((current) =>
            stepEnabledIndex(options, current >= 0 ? current : selectedIndex, -1),
          )
        } else {
          openMenu(selectedIndex >= 0 ? selectedIndex : lastEnabledIndex(options))
        }
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        if (isOpen) {
          if (highlightedIndex >= 0) {
            commitSelection(highlightedIndex)
          }
        } else {
          openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options))
        }
        break
      }
      case 'Home': {
        event.preventDefault()
        if (!isOpen) {
          openMenu(firstEnabledIndex(options))
        } else {
          setHighlightedIndex(firstEnabledIndex(options))
        }
        break
      }
      case 'End': {
        event.preventDefault()
        if (!isOpen) {
          openMenu(lastEnabledIndex(options))
        } else {
          setHighlightedIndex(lastEnabledIndex(options))
        }
        break
      }
      case 'Escape': {
        if (isOpen) {
          event.preventDefault()
          closeMenu(true)
        }
        break
      }
      default:
        break
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setHighlightedIndex((current) =>
          stepEnabledIndex(options, current >= 0 ? current : selectedIndex, 1),
        )
        break
      case 'ArrowUp':
        event.preventDefault()
        setHighlightedIndex((current) =>
          stepEnabledIndex(options, current >= 0 ? current : selectedIndex, -1),
        )
        break
      case 'Home':
        event.preventDefault()
        setHighlightedIndex(firstEnabledIndex(options))
        break
      case 'End':
        event.preventDefault()
        setHighlightedIndex(lastEnabledIndex(options))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (highlightedIndex >= 0) {
          commitSelection(highlightedIndex)
        }
        break
      case 'Escape':
        event.preventDefault()
        closeMenu(true)
        break
      case 'Tab':
        closeMenu(false)
        break
      default:
        break
    }
  }

  const menu =
    isOpen && menuPosition
      ? createPortal(
          <div
            aria-activedescendant={
              highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
            }
            aria-label={menuLabel ?? ariaLabel}
            className={['custom-select__menu', menuClassName].filter(Boolean).join(' ')}
            id={listboxId}
            onKeyDown={handleMenuKeyDown}
            ref={menuRef}
            role="listbox"
            style={
              {
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                minWidth: `${menuPosition.minWidth}px`,
                maxWidth: `${menuPosition.maxWidth}px`,
                transformOrigin: menuPosition.transformOrigin,
              } satisfies CSSProperties
            }
            tabIndex={-1}
          >
            {menuLabel ? (
              <div aria-hidden="true" className="custom-select__menu-label">
                {menuLabel}
              </div>
            ) : null}
            {options.map((option, index) => {
              const isSelected = option.value === value
              const isHighlighted = index === highlightedIndex
              const optionClasses = [
                'custom-select__option',
                isSelected ? 'custom-select__option--selected' : '',
                isHighlighted ? 'custom-select__option--highlighted' : '',
                option.disabled ? 'custom-select__option--disabled' : '',
                optionClassName,
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <button
                  aria-selected={isSelected}
                  className={optionClasses}
                  disabled={option.disabled}
                  id={`${listboxId}-option-${index}`}
                  key={`${option.value}-${index}`}
                  onClick={() => commitSelection(index)}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setHighlightedIndex(index)
                    }
                  }}
                  ref={(element) => {
                    optionRefs.current[index] = element
                  }}
                  role="option"
                  type="button"
                >
                  <span className="custom-select__option-label">{option.label}</span>
                  <span
                    aria-hidden="true"
                    className={isSelected ? 'custom-select__check custom-select__check--visible' : 'custom-select__check'}
                  >
                    <CheckIcon />
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <div className={classes} ref={rootRef}>
        <button
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className="custom-select__trigger"
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              closeMenu(false)
              return
            }

            openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options))
          }}
          onKeyDown={handleTriggerKeyDown}
          ref={triggerRef}
          title={selectedLabel}
          type="button"
        >
          <span className="custom-select__value">{selectedLabel}</span>
          <span aria-hidden="true" className="custom-select__caret">
            <CaretIcon />
          </span>
        </button>
      </div>
      {menu}
    </>
  )
}
