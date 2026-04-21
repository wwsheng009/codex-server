// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

vi.mock('../../features/catalog/api', () => ({
  listModels: vi.fn(),
}))

import { listModels } from '../../features/catalog/api'
import { i18n } from '../../i18n/runtime'
import type { Automation, BackgroundJobExecutor, Workspace } from '../../types/api'
import { JobFormFields } from './JobFormFields'

const mockedListModels = vi.mocked(listModels)

type Draft = {
  name: string
  description: string
  workspaceId: string
  executorKind: string
  payload: string
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function buildWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_jobs',
    name: 'Jobs Workspace',
    rootPath: 'E:/projects/ai/codex-server',
    runtimeStatus: 'running',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

function buildAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto_live_123',
    title: 'Nightly Summary',
    description: 'Summarize the workspace',
    prompt: 'Summarize the latest changes.',
    workspaceId: 'ws_jobs',
    workspaceName: 'Jobs Workspace',
    schedule: 'manual',
    scheduleLabel: 'Manual',
    model: 'gpt-5.4',
    reasoning: 'medium',
    status: 'active',
    nextRun: '',
    lastRun: null,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

function buildExecutor(overrides: Partial<BackgroundJobExecutor> = {}): BackgroundJobExecutor {
  return {
    kind: 'prompt_run',
    title: 'Prompt Run',
    description: 'Run a prompt directly.',
    supportsSchedule: true,
    form: {
      fields: [],
    },
    ...overrides,
  }
}

function Harness({
  currentExecutor,
  automations = [],
  initialPayload = '{}',
}: {
  currentExecutor: BackgroundJobExecutor
  automations?: Automation[]
  initialPayload?: string
}) {
  const workspace = buildWorkspace()
  const [queryClient] = useState(() => createQueryClient())
  const [draft, setDraft] = useState<Draft>({
    name: 'Jobs Harness',
    description: 'Testing',
    workspaceId: workspace.id,
    executorKind: currentExecutor.kind,
    payload: initialPayload,
  })

  return (
    <QueryClientProvider client={queryClient}>
      <JobFormFields
        draft={draft}
        setDraft={setDraft}
        workspaces={[workspace]}
        executors={[currentExecutor]}
        automations={automations}
        currentExecutor={currentExecutor}
      />
      <output data-testid="payload">{draft.payload}</output>
    </QueryClientProvider>
  )
}

describe('JobFormFields datasource-driven rendering', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  afterEach(() => {
    mockedListModels.mockReset()
    cleanup()
  })

  it('renders workspace model catalogs for text fields with datasource metadata', async () => {
    mockedListModels.mockResolvedValue([
      {
        id: 'gpt-5.4',
        name: 'Workspace GPT-5.4',
        description: 'Workspace model',
      },
    ])

    const executor = buildExecutor({
      form: {
        fields: [
          {
            purpose: 'model',
            kind: 'text',
            label: 'Model',
            payloadKey: 'model',
            dataSource: {
              kind: 'workspace_models',
              allowCustomValue: true,
            },
          },
        ],
      },
    })

    render(<Harness currentExecutor={executor} initialPayload={JSON.stringify({ model: 'gpt-5.4' })} />)

    await waitFor(() => expect(mockedListModels).toHaveBeenCalledWith('ws_jobs'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain('Workspace GPT-5.4'),
    )
    expect(screen.getByDisplayValue('gpt-5.4')).toBeTruthy()
  })

  it('renders workspace automation catalogs for select fields with datasource metadata', async () => {
    const automation = buildAutomation()
    const executor = buildExecutor({
      kind: 'automation_run',
      title: 'Automation Run',
      form: {
        fields: [
          {
            purpose: 'automationRef',
            kind: 'select',
            label: 'Automation',
            payloadKey: 'automationId',
            dataSource: {
              kind: 'workspace_automations',
              allowBlank: true,
              blankLabel: 'Select Automation',
            },
          },
        ],
      },
    })

    render(<Harness currentExecutor={executor} automations={[automation]} />)

    await waitFor(() =>
      expect(screen.getByTestId('payload').textContent).toContain('"automationId": "auto_live_123"'),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Automation' }).textContent).toContain(
        'Nightly Summary · auto_live_123',
      ),
    )
    expect(
      screen.getByText(
        'Choose which existing Automation this job should run. Jobs create their own IDs automatically; this only links the job to an Automation target.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Automation Target')).toBeTruthy()
    expect(
      screen.getByText(
        'This job will run Automation "Nightly Summary". Edit its prompt on the Automations page. Default model: gpt-5.4. Reasoning: medium.',
      ),
    ).toBeTruthy()
    expect(screen.getByLabelText('Selected Automation Prompt')).toBeTruthy()
  })
})
