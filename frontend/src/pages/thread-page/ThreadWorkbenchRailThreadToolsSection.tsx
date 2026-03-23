import { CollapsiblePanel } from '../../components/ui/CollapsiblePanel'
import { i18n } from '../../i18n/runtime'
import type { ThreadWorkbenchRailProps } from './threadWorkbenchRailTypes'

export function ThreadWorkbenchRailThreadToolsSection({
  deletePending,
  deletingThreadId,
  editingThreadId,
  editingThreadName,
  isThreadToolsExpanded,
  onArchiveToggle,
  onBeginRenameThread,
  onCancelRenameThread,
  onChangeEditingThreadName,
  onDeleteThread,
  onSubmitRenameThread,
  onToggleThreadToolsExpanded,
  selectedThread,
}: Pick<
  ThreadWorkbenchRailProps,
  | 'deletePending'
  | 'deletingThreadId'
  | 'editingThreadId'
  | 'editingThreadName'
  | 'isThreadToolsExpanded'
  | 'onArchiveToggle'
  | 'onBeginRenameThread'
  | 'onCancelRenameThread'
  | 'onChangeEditingThreadName'
  | 'onDeleteThread'
  | 'onSubmitRenameThread'
  | 'onToggleThreadToolsExpanded'
  | 'selectedThread'
>) {
  const isEditingSelectedThread = Boolean(selectedThread && editingThreadId === selectedThread.id)

  return (
    <CollapsiblePanel
      expanded={isThreadToolsExpanded}
      onToggle={onToggleThreadToolsExpanded}
      title={i18n._({
        id: 'Thread tools',
        message: 'Thread tools',
      })}
    >
      {selectedThread ? (
        <>
          <div className="header-actions">
            <button
              className="ide-button ide-button--secondary"
              onClick={onBeginRenameThread}
              type="button"
            >
              {i18n._({
                id: 'Rename',
                message: 'Rename',
              })}
            </button>
            <button
              className="ide-button ide-button--secondary"
              onClick={onArchiveToggle}
              type="button"
            >
              {selectedThread.archived
                ? i18n._({
                    id: 'Unarchive',
                    message: 'Unarchive',
                  })
                : i18n._({
                    id: 'Archive',
                    message: 'Archive',
                  })}
            </button>
            <button
              className="ide-button ide-button--danger"
              disabled={deletePending}
              onClick={onDeleteThread}
              type="button"
            >
              {deletePending && deletingThreadId === selectedThread.id
                ? i18n._({
                    id: 'Deleting…',
                    message: 'Deleting…',
                  })
                : i18n._({
                    id: 'Delete',
                    message: 'Delete',
                  })}
            </button>
          </div>
          {isEditingSelectedThread ? (
            <form className="form-stack" onSubmit={onSubmitRenameThread}>
              <label className="field">
                <span>
                  {i18n._({
                    id: 'Rename thread',
                    message: 'Rename thread',
                  })}
                </span>
                <input
                  onChange={(event) => onChangeEditingThreadName(event.target.value)}
                  value={editingThreadName}
                />
              </label>
              <div className="header-actions">
                <button className="ide-button" disabled={!editingThreadName.trim()} type="submit">
                  {i18n._({
                    id: 'Save',
                    message: 'Save',
                  })}
                </button>
                <button
                  className="ide-button ide-button--secondary"
                  onClick={onCancelRenameThread}
                  type="button"
                >
                  {i18n._({
                    id: 'Cancel',
                    message: 'Cancel',
                  })}
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </CollapsiblePanel>
  )
}
