import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { Switch } from '../components/ui/Switch'
import { TextArea } from '../components/ui/TextArea'
import { i18n } from '../i18n/runtime'

type WorkspaceOption = {
  id: string
  name: string
}

type BotsPageCreateBotModalProps = {
  createBotDescriptionDraft: string
  createBotFormErrorMessage: string
  createBotModalOpen: boolean
  createBotNameDraft: string
  createBotScopeDraft: 'workspace' | 'global'
  createBotShareableWorkspaces: WorkspaceOption[]
  createBotSharedWorkspaceIdsDraft: string[]
  createBotSharingModeDraft: 'owner_only' | 'all_workspaces' | 'selected_workspaces'
  createBotWorkspaceId: string
  isEditingBot: boolean
  isCreateBotPending: boolean
  onChangeCreateBotDescription: (nextValue: string) => void
  onChangeCreateBotName: (nextValue: string) => void
  onChangeCreateBotScope: (nextValue: 'workspace' | 'global') => void
  onChangeCreateBotSharingMode: (nextValue: 'owner_only' | 'all_workspaces' | 'selected_workspaces') => void
  onChangeCreateBotWorkspaceId: (nextValue: string) => void
  onClose: () => void
  onSubmit: () => void
  onToggleCreateBotSharedWorkspaceId: (workspaceId: string, checked: boolean) => void
  workspaces: WorkspaceOption[]
}

export function BotsPageCreateBotModal({
  createBotDescriptionDraft,
  createBotFormErrorMessage,
  createBotModalOpen,
  createBotNameDraft,
  createBotScopeDraft,
  createBotShareableWorkspaces,
  createBotSharedWorkspaceIdsDraft,
  createBotSharingModeDraft,
  createBotWorkspaceId,
  isCreateBotPending,
  isEditingBot,
  onChangeCreateBotDescription,
  onChangeCreateBotName,
  onChangeCreateBotScope,
  onChangeCreateBotSharingMode,
  onChangeCreateBotWorkspaceId,
  onClose,
  onSubmit,
  onToggleCreateBotSharedWorkspaceId,
  workspaces,
}: BotsPageCreateBotModalProps) {
  if (!createBotModalOpen) {
    return null
  }

  return (
    <Modal
      footer={
        <>
          <Button intent="secondary" onClick={onClose} type="button">
            {i18n._({ id: 'Cancel', message: 'Cancel' })}
          </Button>
          <Button isLoading={isCreateBotPending} onClick={onSubmit} type="button">
            {isEditingBot ? i18n._({ id: 'Save Bot', message: 'Save Bot' }) : i18n._({ id: 'Create Bot', message: 'Create Bot' })}
          </Button>
        </>
      }
      onClose={onClose}
      title={isEditingBot ? i18n._({ id: 'Edit Bot', message: 'Edit Bot' }) : i18n._({ id: 'New Bot', message: 'New Bot' })}
    >
      <div className="form-stack">
        {createBotFormErrorMessage ? (
          <InlineNotice
            dismissible={false}
            noticeKey={`create-bot-${createBotFormErrorMessage}`}
            title={
              isEditingBot
                ? i18n._({ id: 'Update Bot Failed', message: 'Update Bot Failed' })
                : i18n._({ id: 'Create Bot Failed', message: 'Create Bot Failed' })
            }
            tone="error"
          >
            {createBotFormErrorMessage}
          </InlineNotice>
        ) : null}

        <label className="field">
          <span>{i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}</span>
          <SelectControl
            ariaLabel={i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}
            disabled={isEditingBot}
            fullWidth
            onChange={onChangeCreateBotWorkspaceId}
            options={workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
            }))}
            value={createBotWorkspaceId}
          />
        </label>

        <div className="form-row">
          <label className="field">
            <span>{i18n._({ id: 'Scope', message: 'Scope' })}</span>
            <SelectControl
              ariaLabel={i18n._({ id: 'Scope', message: 'Scope' })}
              fullWidth
              onChange={(nextValue) => onChangeCreateBotScope(nextValue === 'global' ? 'global' : 'workspace')}
              options={[
                {
                  value: 'workspace',
                  label: i18n._({ id: 'Workspace-scoped', message: 'Workspace-scoped' }),
                },
                {
                  value: 'global',
                  label: i18n._({ id: 'Global', message: 'Global' }),
                },
              ]}
              value={createBotScopeDraft}
            />
          </label>

          <label className="field">
            <span>{i18n._({ id: 'Sharing', message: 'Sharing' })}</span>
            <SelectControl
              ariaLabel={i18n._({ id: 'Sharing', message: 'Sharing' })}
              disabled={createBotScopeDraft !== 'global'}
              fullWidth
              onChange={(nextValue) =>
                onChangeCreateBotSharingMode(
                  nextValue === 'all_workspaces'
                    ? 'all_workspaces'
                    : nextValue === 'selected_workspaces'
                      ? 'selected_workspaces'
                      : 'owner_only',
                )
              }
              options={[
                {
                  value: 'owner_only',
                  label: i18n._({ id: 'Owner workspace only', message: 'Owner workspace only' }),
                },
                {
                  value: 'all_workspaces',
                  label: i18n._({ id: 'All workspaces', message: 'All workspaces' }),
                },
                {
                  value: 'selected_workspaces',
                  label: i18n._({ id: 'Selected workspaces', message: 'Selected workspaces' }),
                },
              ]}
              value={createBotScopeDraft === 'global' ? createBotSharingModeDraft : 'owner_only'}
            />
          </label>
        </div>

        {createBotScopeDraft === 'global' && createBotSharingModeDraft === 'selected_workspaces' ? (
          <div className="field">
            <span>{i18n._({ id: 'Shared Workspaces', message: 'Shared Workspaces' })}</span>
            <div className="detail-list">
              {createBotShareableWorkspaces.length ? (
                createBotShareableWorkspaces.map((workspace) => (
                  <Switch
                    checked={createBotSharedWorkspaceIdsDraft.includes(workspace.id)}
                    key={workspace.id}
                    label={workspace.name}
                    onChange={(event) => onToggleCreateBotSharedWorkspaceId(workspace.id, event.target.checked)}
                  />
                ))
              ) : (
                <div className="notice">
                  {i18n._({
                    id: 'No other workspace is available for selected sharing.',
                    message: 'No other workspace is available for selected sharing.',
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <Input
          hint={i18n._({
            id: 'Bots are the stable logical identity. Endpoints get attached after the bot exists.',
            message: 'Bots are the stable logical identity. Endpoints get attached after the bot exists.',
          })}
          label={i18n._({ id: 'Bot Name', message: 'Bot Name' })}
          onChange={(event) => onChangeCreateBotName(event.target.value)}
          placeholder={i18n._({ id: 'Ops Bot', message: 'Ops Bot' })}
          value={createBotNameDraft}
        />

        <TextArea
          hint={i18n._({
            id: 'Optional. Use this to describe the bot role before endpoints are attached.',
            message: 'Optional. Use this to describe the bot role before endpoints are attached.',
          })}
          label={i18n._({ id: 'Description', message: 'Description' })}
          onChange={(event) => onChangeCreateBotDescription(event.target.value)}
          rows={4}
          value={createBotDescriptionDraft}
        />
      </div>
    </Modal>
  )
}
