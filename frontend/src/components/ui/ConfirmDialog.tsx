import { useEffect, useRef } from 'react'

import { Modal } from './Modal'
import { InlineNotice } from './InlineNotice'

export type ConfirmDialogProps = {
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
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      cancelButtonRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const footer = (
    <>
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
    </>
  )

  return (
    <Modal
      className="confirm-dialog"
      description={description}
      footer={footer}
      maxWidth="min(420px, 100%)"
      onClose={onClose}
      title={title}
    >
      <div className="confirm-dialog__header">
        <span className="confirm-dialog__eyebrow">Confirm</span>
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
    </Modal>
  )
}
