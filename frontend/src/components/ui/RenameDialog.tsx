import { useEffect, useId, useRef } from 'react'

import { InlineNotice } from './InlineNotice'

type RenameDialogProps = {
  title: string
  description: string
  value: string
  fieldLabel?: string
  placeholder?: string
  submitLabel?: string
  isSubmitDisabled?: boolean
  error?: string | null
  isPending?: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function RenameDialog({
  title,
  description,
  value,
  fieldLabel = 'New Name',
  placeholder,
  submitLabel = 'Save',
  isSubmitDisabled = false,
  error,
  isPending = false,
  onChange,
  onClose,
  onSubmit,
}: RenameDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
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
      <button aria-label="Close rename dialog" className="modal-backdrop" onClick={onClose} type="button" />
      <div className="modal-shell">
        <div
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className="modal-card rename-dialog"
          role="dialog"
        >
          <div className="rename-dialog__header">
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>

          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            <label className="field" htmlFor={inputId}>
              <span>{fieldLabel}</span>
              <input
                id={inputId}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                ref={inputRef}
                value={value}
              />
            </label>

            {error ? (
              <InlineNotice
                dismissible
                noticeKey={`rename-dialog-${title}-${error}`}
                title="Rename Failed"
                tone="error"
              >
                {error}
              </InlineNotice>
            ) : null}

            <div className="rename-dialog__actions">
              <button className="ide-button ide-button--secondary" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="ide-button" disabled={isSubmitDisabled} type="submit">
                {isPending ? 'Saving…' : submitLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
