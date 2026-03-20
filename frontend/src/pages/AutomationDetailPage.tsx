import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PageHeader } from '../components/ui/PageHeader'
import { deleteAutomationRecord, getAutomationRecord, updateAutomationRecord, type AutomationRecord } from '../features/automations/store'

export function AutomationDetailPage() {
  const { automationId = '' } = useParams()
  const navigate = useNavigate()
  const [automation, setAutomation] = useState<AutomationRecord | null>(null)

  useEffect(() => {
    setAutomation(getAutomationRecord(automationId) ?? null)
  }, [automationId])

  if (!automation) {
    return (
      <section className="screen screen--centered">
        <section className="empty-card">
          <p className="page-header__eyebrow">Automation</p>
          <h1>Automation Not Found</h1>
          <p className="page-header__description">The requested automation is not available in local storage.</p>
          <div className="header-actions">
            <Link className="ide-button" to="/automations">
              Back to Automations
            </Link>
          </div>
        </section>
      </section>
    )
  }

  const currentAutomation = automation

  function toggleStatus() {
    const next = updateAutomationRecord(currentAutomation.id, (record) => ({
      ...record,
      status: record.status === 'active' ? 'paused' : 'active',
    }))
    setAutomation(next)
  }

  function removeAutomation() {
    deleteAutomationRecord(currentAutomation.id)
    navigate('/automations')
  }

  return (
    <section className="screen">
      <PageHeader
        actions={
          <div className="header-actions">
            <button className="ide-button ide-button--secondary" onClick={toggleStatus} type="button">
              {currentAutomation.status === 'active' ? 'Pause' : 'Resume'}
            </button>
            <button className="ide-button" onClick={() => navigate(`/workspaces/${currentAutomation.workspaceId}`)} type="button">
              Open Workspace
            </button>
            <button className="ide-button ide-button--secondary" onClick={removeAutomation} type="button">
              Delete
            </button>
          </div>
        }
        description="A codx-style detail view with primary content on the left and operational state in a right-side detail panel."
        eyebrow="Automation Detail"
        meta={
          <>
            <span className="meta-pill">{currentAutomation.scheduleLabel}</span>
            <span className="meta-pill">{currentAutomation.model}</span>
          </>
        }
        title={currentAutomation.title}
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
              <p>{currentAutomation.description}</p>
            </div>
            <div className="detail-copy">
              <span>Prompt</span>
              <pre className="code-block">{currentAutomation.prompt}</pre>
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
            <DetailRow label="Status" value={currentAutomation.status} />
            <DetailRow label="Next Run" value={currentAutomation.nextRun} />
            <DetailRow label="Last Run" value={currentAutomation.lastRun ?? 'Never'} />
            <DetailRow label="Workspace" value={currentAutomation.workspaceName} />
            <DetailRow label="Repeats" value={currentAutomation.scheduleLabel} />
            <DetailRow label="Model" value={currentAutomation.model} />
            <DetailRow label="Reasoning" value={currentAutomation.reasoning} />
            <DetailRow label="Previous Runs" value="No runs yet" />
          </div>
        </section>
      </div>
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
