import { useEffect, useId, useRef } from 'react'

import { Modal } from '../ui/Modal'
import { InlineNotice } from '../ui/InlineNotice'

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
        Cancel
      </button>
      <button className="ide-button" disabled={isSubmitDisabled} type="submit">
        {isPending ? 'Creating…' : 'Register Workspace'}
      </button>
    </>
  )

  return (
    <Modal
      description="Register a runtime root to start building threads and automations."
      footer={footer}
      maxWidth="min(520px, 100%)"
      onClose={onClose}
      title="Create Workspace"
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label className="field" htmlFor={nameInputId}>
          <span>Name</span>
          <input
            id={nameInputId}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="ai-gateway"
            ref={nameInputRef}
            value={name}
          />
        </label>

        <label className="field">
          <span>Root Path</span>
          <input
            onChange={(event) => onRootPathChange(event.target.value)}
            placeholder="E:/projects/my-app"
            value={rootPath}
          />
        </label>

        {error ? (
          <InlineNotice
            dismissible
            noticeKey="create-workspace-error"
            title="Setup Failed"
            tone="error"
          >
            {error}
          </InlineNotice>
        ) : null}
      </form>
    </Modal>
  )
}
