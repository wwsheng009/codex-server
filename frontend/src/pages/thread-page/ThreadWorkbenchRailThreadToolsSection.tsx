import { DetailGroup } from '../../components/ui/DetailGroup'
import { i18n } from '../../i18n/runtime'
import { Tooltip } from '../../components/ui/Tooltip'
import type {
  ThreadWorkbenchRailInfoLabelProps,
  ThreadWorkbenchRailThreadToolsSectionProps,
} from './threadWorkbenchRailTypes'

function InfoLabel({
  help,
  label,
}: ThreadWorkbenchRailInfoLabelProps) {
  if (!help) {
    return <span className="info-label">{label}</span>
  }

  return (
    <span className="info-label">
      <span>{label}</span>
      <Tooltip
        content={help}
        position="left"
        triggerLabel={i18n._({
          id: '{label} help',
          message: '{label} help',
          values: { label },
        })}
      >
        <span aria-hidden="true" className="info-label__help">
          ?
        </span>
      </Tooltip>
    </span>
  )
}

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
}: ThreadWorkbenchRailThreadToolsSectionProps) {
  const isEditingSelectedThread = Boolean(selectedThread && editingThreadId === selectedThread.id)

  return (
    <DetailGroup
      collapsible
      open={isThreadToolsExpanded}
      onToggle={onToggleThreadToolsExpanded}
      title={i18n._({
        id: 'Thread tools',
        message: 'Thread tools',
      })}
    >
      {selectedThread ? (
        <div className="pane-section-content">
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
            <form className="form-stack" style={{ marginTop: 12 }} onSubmit={onSubmitRenameThread}>
              <label className="field">
                <InfoLabel
                  label={i18n._({
                    id: 'Rename thread',
                    message: 'Rename thread',
                  })}
                />
                <input
                  className="field-input"
                  onChange={(event) => onChangeEditingThreadName(event.target.value)}
                  value={editingThreadName}
                />
              </label>
              <div className="header-actions">
                <button
                  className="ide-button ide-button--primary"
                  disabled={!editingThreadName.trim()}
                  type="submit"
                >
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
        </div>
      ) : null}
    </DetailGroup>
  )
}
