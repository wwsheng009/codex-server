import type { Dispatch, SetStateAction } from 'react'

import { i18n } from '../../i18n/runtime'
import type { AutomationTemplate } from '../../features/automations/store'
import type { Workspace } from '../../types/api'
import type { Draft } from '../../pages/automationsPageTypes'
import { Input } from './Input'
import { SelectControl } from './SelectControl'
import { TextArea } from './TextArea'

type AutomationFormFieldsProps = {
  draft: Draft
  setDraft: Dispatch<SetStateAction<Draft>>
  templates: AutomationTemplate[]
  activeTemplateId?: string
  workspaces: Workspace[]
  onTemplateChange: (templateId: string) => void
}

export function AutomationFormFields({
  draft,
  setDraft,
  templates,
  activeTemplateId = '',
  workspaces,
  onTemplateChange,
}: AutomationFormFieldsProps) {
  return (
    <>
      <div className="form-row">
        <label className="field">
          <span>{i18n._({ id: 'Capability Template', message: 'Capability Template' })}</span>
          <SelectControl
            ariaLabel={i18n._({ id: 'Select a template', message: 'Select a template' })}
            fullWidth
            onChange={onTemplateChange}
            options={[
              {
                value: '',
                label: i18n._({
                  id: 'None (Start from scratch)',
                  message: 'None (Start from scratch)',
                }),
              },
              ...templates.map((template) => ({ value: template.id, label: `[${template.category}] ${template.title}` })),
            ]}
            value={activeTemplateId}
          />
        </label>
        <label className="field">
          <span>{i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}</span>
          <SelectControl
            ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
            fullWidth
            onChange={(nextValue) => setDraft((current) => ({ ...current, workspaceId: nextValue }))}
            options={workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
            }))}
            value={draft.workspaceId}
          />
        </label>
      </div>

      <div className="form-row">
        <Input
          label={i18n._({ id: 'Title', message: 'Title' })}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder={i18n._({ id: 'Daily Sync', message: 'Daily Sync' })}
          value={draft.title}
        />
        <Input
          label={i18n._({ id: 'Description', message: 'Description' })}
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          placeholder={i18n._({
            id: "Briefly describe the automation's purpose...",
            message: "Briefly describe the automation's purpose...",
          })}
          value={draft.description}
        />
      </div>

      <TextArea
        label={i18n._({ id: 'Prompt', message: 'Prompt' })}
        onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
        placeholder={i18n._({
          id: 'What should the assistant do?',
          message: 'What should the assistant do?',
        })}
        rows={5}
        value={draft.prompt}
      />
    </>
  )
}
