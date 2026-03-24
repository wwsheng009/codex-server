import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
  content: ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  triggerLabel?: string
}

export function Tooltip({
  content,
  children,
  position = 'top',
  className = '',
  triggerLabel = 'Show help',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const showTimeoutRef = useRef<number | null>(null)
  const hideTimeoutRef = useRef<number | null>(null)

  const showTooltip = () => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    if (!isVisible) {
      showTimeoutRef.current = window.setTimeout(() => {
        setIsVisible(true)
      }, 200)
    }
  }

  const hideTooltip = () => {
    if (showTimeoutRef.current) {
      window.clearTimeout(showTimeoutRef.current)
      showTimeoutRef.current = null
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false)
    }, 150)
  }

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) {
      return
    }

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()

    let top = 0
    let left = 0

    switch (position) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - 8
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
        break
      case 'bottom':
        top = triggerRect.bottom + 8
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
        break
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
        left = triggerRect.left - tooltipRect.width - 8
        break
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2
        left = triggerRect.right + 8
        break
    }

    const padding = 8
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding))
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding))

    setCoords({ top: top + window.scrollY, left: left + window.scrollX })
  }

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) window.clearTimeout(showTimeoutRef.current)
      if (hideTimeoutRef.current) window.clearTimeout(hideTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) {
      return
    }

    updatePosition()

    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsVisible(false)
        triggerRef.current?.focus()
      }
    }

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isVisible, position])

  const classes = ['ide-tooltip-container', className].filter(Boolean).join(' ')

  return (
    <span className={classes}>
      <button
        aria-describedby={isVisible ? tooltipId : undefined}
        aria-expanded={isVisible}
        aria-label={triggerLabel}
        className="ide-tooltip-trigger"
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null
          if (nextTarget && tooltipRef.current?.contains(nextTarget)) {
            return
          }
          hideTooltip()
        }}
        onClick={() => setIsVisible((current) => !current)}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        ref={triggerRef}
        type="button"
      >
        {children}
      </button>
      {isVisible && typeof document !== 'undefined'
        ? createPortal(
          <div
            className={`ide-tooltip ide-tooltip--${position}`}
            id={tooltipId}
            onMouseEnter={showTooltip}
            onMouseLeave={hideTooltip}
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: 'absolute',
              top: coords.top,
              left: coords.left,
              zIndex: 9999,
            }}
          >
            <div className="ide-tooltip__content">{content}</div>
            <div className="ide-tooltip__arrow" />
          </div>,
          document.body,
        )
        : null}
    </span>
  )
}
