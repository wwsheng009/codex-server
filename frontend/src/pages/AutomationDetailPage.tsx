import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import {
  deleteAutomation,
  getAutomation,
  pauseAutomation,
  resumeAutomation,
} from '../features/automations/api'
import { isApiClientErrorCode } from '../lib/api-client'
import { getErrorMessage } from '../lib/error-utils'

export function AutomationDetailPage() {
  const { automationId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const automationQuery = useQuery({
    queryKey: ['automation', automationId],
    queryFn: () => getAutomation(automationId),
    enabled: automationId.length > 0,
  })
  const statusMutation = useMutation({
    mutationFn: async (input: { automationId: string; status: string }) => {
      return input.status === 'active'
        ? pauseAutomation(input.automationId)
        : resumeAutomation(input.automationId)
    },
    onSuccess: async (automation) => {
      queryClient.setQueryData(['automation', automation.id], automation)
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: async (_, id) => {
      queryClient.removeQueries({ queryKey: ['automation', id] })
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
      navigate('/automations')
    },
  })

  if (!automationId) {
    return <AutomationNotFound />
  }

  if (automationQuery.isLoading) {
    return (
      <section className="screen screen--centered">
        <section className="empty-card">
          <p className="page-header__eyebrow">Automation</p>
          <h1>Loading Automation</h1>
          <p className="page-header__description">Fetching the latest automation data from the server.</p>
        </section>
      </section>
    )
  }

  if (automationQuery.error) {
    if (isApiClientErrorCode(automationQuery.error, 'automation_not_found')) {
      return <AutomationNotFound />
    }

    return (
      <section className="screen screen--centered">
        <section className="empty-card">
          <p className="page-header__eyebrow">Automation</p>
          <h1>Automation Unavailable</h1>
          <InlineNotice
            dismissible
            noticeKey={`automation-detail-${automationId}-${getErrorMessage(automationQuery.error)}`}
            title="Automation Loading Failed"
            tone="error"
          >
            {getErrorMessage(automationQuery.error)}
          </InlineNotice>
          <div className="header-actions">
            <Link className="ide-button" to="/automations">
              Back to Automations
            </Link>
          </div>
        </section>
      </section>
    )
  }

  const automation = automationQuery.data
  if (!automation) {
    return <AutomationNotFound />
  }

  return (
    <section className="screen">
      {statusMutation.error || deleteMutation.error ? (
        <InlineNotice
          dismissible
          noticeKey={`automation-detail-action-${automation.id}-${getErrorMessage(statusMutation.error ?? deleteMutation.error)}`}
          title="Automation Update Failed"
          tone="error"
        >
          {getErrorMessage(statusMutation.error ?? deleteMutation.error)}
        </InlineNotice>
      ) : null}

      <PageHeader
        actions={
          <div className="header-actions">
            <Button
              intent="secondary"
              isLoading={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ automationId: automation.id, status: automation.status })}
            >
              {automation.status === 'active' ? 'Pause' : 'Resume'}
            </Button>
            <Button onClick={() => navigate(`/workspaces/${automation.workspaceId}`)}>
              Open Workspace
            </Button>
            <Button intent="secondary" isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(automation.id)}>
              Delete
            </Button>
          </div>
        }
        description="A codx-style detail view with primary content on the left and operational state in a right-side detail panel."
        eyebrow="Automation Detail"
        meta={
          <>
            <span className="meta-pill">{automation.scheduleLabel}</span>
            <span className="meta-pill">{automation.model}</span>
          </>
        }
        title={automation.title}
      />

      <div className="detail-layout">
        <section className="detail-layout__main settings-section">
          <div className="section-header">
            <div>
              <h2>Summary</h2>
              <p>Prompt and description used by the automation runner.</p>
            </div>
          </div>
          <div className="stack-screen">
            <div className="detail-copy">
              <span>Description</span>
              <p>{automation.description}</p>
            </div>
            <div className="detail-copy">
              <span>Prompt</span>
              <pre className="code-block">{automation.prompt}</pre>
            </div>
          </div>
        </section>

        <section className="detail-layout__aside settings-section">
          <div className="section-header">
            <div>
              <h2>Details</h2>
              <p>Current status and execution parameters.</p>
            </div>
          </div>
          <div className="detail-list">
            <DetailRow label="Status" value={automation.status} />
            <DetailRow label="Next Run" value={automation.nextRun} />
            <DetailRow label="Last Run" value={automation.lastRun ?? 'Never'} />
            <DetailRow label="Workspace" value={automation.workspaceName} />
            <DetailRow label="Repeats" value={automation.scheduleLabel} />
            <DetailRow label="Model" value={automation.model} />
            <DetailRow label="Reasoning" value={automation.reasoning} />
            <DetailRow label="Previous Runs" value="No runs yet" />
          </div>
        </section>
      </div>
    </section>
  )
}

function AutomationNotFound() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">Automation</p>
        <h1>Automation Not Found</h1>
        <p className="page-header__description">The requested automation could not be found on the server.</p>
        <div className="header-actions">
          <Link className="ide-button" to="/automations">
            Back to Automations
          </Link>
        </div>
      </section>
    </section>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
