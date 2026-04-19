import type { Dispatch, SetStateAction } from 'react'

import { i18n } from '../../i18n/runtime'
import type { BackgroundJobExecutor, Workspace } from '../../types/api'
import { Input } from './Input'
import { InlineNotice } from './InlineNotice'
import { SelectControl } from './SelectControl'
import { TextArea } from './TextArea'

type JobDraft = {
  name: string
  description: string
  workspaceId: string
  executorKind: string
  payload: string
}

type JobFormFieldsProps<TDraft extends JobDraft> = {
  draft: TDraft
  setDraft: Dispatch<SetStateAction<TDraft>>
  workspaces: Workspace[]
  executors: BackgroundJobExecutor[]
  currentExecutor: BackgroundJobExecutor | null
}

export function JobFormFields<TDraft extends JobDraft>({
  draft,
  setDraft,
  workspaces,
  executors,
  currentExecutor,
}: JobFormFieldsProps<TDraft>) {
  return (
    <>
      <Input
        label={i18n._({ id: 'Job Name', message: 'Job Name' })}
        value={draft.name}
        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
      />
      <label className="field">
        <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
        <SelectControl
          ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
          fullWidth
          value={draft.workspaceId}
          onChange={(nextValue) => setDraft((current) => ({ ...current, workspaceId: nextValue }))}
          options={workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
          }))}
        />
      </label>
      <TextArea
        label={i18n._({ id: 'Description', message: 'Description' })}
        value={draft.description}
        onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
      />
      <label className="field">
        <span>{i18n._({ id: 'Executor', message: 'Executor' })}</span>
        <SelectControl
          ariaLabel={i18n._({ id: 'Executor', message: 'Executor' })}
          fullWidth
          value={draft.executorKind}
          onChange={(nextKind) => {
            const executor = executors.find((item) => item.kind === nextKind) ?? null
            setDraft((current) => ({
              ...current,
              executorKind: nextKind,
              payload: JSON.stringify(executor?.examplePayload ?? {}, null, 2),
            }))
          }}
          options={executors.map((executor) => ({
            value: executor.kind,
            label: `${executor.title} · ${executor.kind}`,
          }))}
        />
      </label>
      <TextArea
        label={i18n._({ id: 'Payload JSON', message: 'Payload JSON' })}
        value={draft.payload}
        rows={12}
        onChange={(event) => setDraft((current) => ({ ...current, payload: event.target.value }))}
      />
      {currentExecutor ? (
        <InlineNotice tone="info" title={currentExecutor.title}>
          {currentExecutor.description}
        </InlineNotice>
      ) : null}
      {currentExecutor?.payloadSchema ? (
        <TextArea
          label={i18n._({ id: 'Executor Schema', message: 'Executor Schema' })}
          value={JSON.stringify(currentExecutor.payloadSchema, null, 2)}
          rows={10}
          readOnly
        />
      ) : null}
    </>
  )
}
