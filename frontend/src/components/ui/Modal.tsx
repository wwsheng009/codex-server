import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'

export type ModalProps = {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  maxWidth?: string
  className?: string
}

/**
 * A generic Modal component that handles common UI patterns:
 * - Backdrop for clicking out
 * - Shell and centered card
 * - ARIA accessibility (dialog role, aria-labelledby, aria-describedby)
 * - Keyboard Escape handling
 */
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  maxWidth = 'min(560px, 100%)',
  className = '',
}: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    // Capture focus or manage scroll lock can be added here if needed
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <>
      <button
        aria-label={`Close ${title}`}
        className="modal-backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="modal-shell">
        <div
          aria-describedby={description ? descriptionId : undefined}
          aria-labelledby={titleId}
          className={`modal-card ${className}`}
          role="dialog"
          style={{ width: maxWidth }}
        >
          <div className="modal-card__header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
          </div>

          <div className="modal-card__body">
            {children}
          </div>

          {footer && (
            <div className="modal-card__footer">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
