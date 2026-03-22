import { useEffect, useId, useRef } from 'react'

import { i18n } from '../../i18n/runtime'
import { Modal } from '../ui/Modal'
import { InlineNotice } from '../ui/InlineNotice'
import { Input } from '../ui/Input'

type CreateWorkspaceDialogProps = {
  name: string
  rootPath: string
  isPending?: boolean
  error?: string | null
  onNameChange: (value: string) => void
  onRootPathChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function CreateWorkspaceDialog({
  name,
  rootPath,
  isPending = false,
  error,
  onNameChange,
  onRootPathChange,
  onClose,
  onSubmit,
}: CreateWorkspaceDialogProps) {
  const formId = useId()
  const nameInputId = useId()
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const isSubmitDisabled = !name.trim() || !rootPath.trim() || isPending

  const footer = (
    <>
      <button className="ide-button ide-button--secondary" onClick={onClose} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </button>
      <button className="ide-button" disabled={isSubmitDisabled} form={formId} type="submit">
        {isPending
          ? i18n._({ id: 'Creating…', message: 'Creating…' })
          : i18n._({ id: 'Register Workspace', message: 'Register Workspace' })}
      </button>
    </>
  )

  return (
    <Modal
      description={i18n._({
        id: 'Register a runtime root to start building threads and automations.',
        message: 'Register a runtime root to start building threads and automations.',
      })}
      footer={footer}
      maxWidth="min(520px, 100%)"
      onClose={onClose}
      title={i18n._({ id: 'Create Workspace', message: 'Create Workspace' })}
    >
      <form
        className="form-stack"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <Input
          id={nameInputId}
          label={i18n._({ id: 'Name', message: 'Name' })}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="ai-gateway"
          ref={nameInputRef}
          value={name}
        />

        <Input
          label={i18n._({ id: 'Root Path', message: 'Root Path' })}
          onChange={(event) => onRootPathChange(event.target.value)}
          placeholder="E:/projects/my-app"
          value={rootPath}
        />

        {error ? (
          <InlineNotice
            dismissible
            noticeKey="create-workspace-error"
            title={i18n._({ id: 'Setup Failed', message: 'Setup Failed' })}
            tone="error"
          >
            {error}
          </InlineNotice>
        ) : null}
      </form>
    </Modal>
  )
}
