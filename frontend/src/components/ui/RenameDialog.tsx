import { useEffect, useId, useRef } from 'react'

import { Modal } from './Modal'
import { InlineNotice } from './InlineNotice'
import { Input } from './Input'
import type { RenameDialogProps } from './renameDialogTypes'

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
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const footer = (
    <>
      <button className="ide-button ide-button--secondary" onClick={onClose} type="button">
        Cancel
      </button>
      <button className="ide-button" disabled={isSubmitDisabled} type="submit">
        {isPending ? 'Saving…' : submitLabel}
      </button>
    </>
  )

  return (
    <Modal
      className="rename-dialog"
      description={description}
      footer={footer}
      maxWidth="min(420px, 100%)"
      onClose={onClose}
      title={title}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <Input
          id={inputId}
          label={fieldLabel}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />

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
      </form>
    </Modal>
  )
}
