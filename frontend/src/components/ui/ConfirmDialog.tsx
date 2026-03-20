import { useEffect, useId, useRef } from 'react'

import { InlineNotice } from './InlineNotice'

type ConfirmDialogProps = {
  title: string
  description: string
  subject?: string
  confirmLabel: string
  cancelLabel?: string
  error?: string | null
  isPending?: boolean
  onClose: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  title,
  description,
  subject,
  confirmLabel,
  cancelLabel = 'Cancel',
  error,
  isPending = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      cancelButtonRef.current?.focus()
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <>
      <button aria-label="Close confirmation dialog" className="modal-backdrop" onClick={onClose} type="button" />
      <div className="modal-shell">
        <div
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className="modal-card confirm-dialog"
          role="dialog"
        >
          <div className="confirm-dialog__header">
            <span className="confirm-dialog__eyebrow">Confirm</span>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
            {subject ? <div className="confirm-dialog__subject">{subject}</div> : null}
          </div>

          {error ? (
            <InlineNotice
              dismissible
              noticeKey={`confirm-dialog-${title}-${subject ?? 'default'}-${error}`}
              title="Action Failed"
              tone="error"
            >
              {error}
            </InlineNotice>
          ) : null}

          <div className="confirm-dialog__actions">
            <button
              className="ide-button ide-button--secondary"
              onClick={onClose}
              ref={cancelButtonRef}
              type="button"
            >
              {cancelLabel}
            </button>
            <button className="ide-button ide-button--danger" onClick={onConfirm} type="button">
              {isPending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
