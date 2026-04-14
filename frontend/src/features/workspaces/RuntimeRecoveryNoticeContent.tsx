import type { WorkspaceRuntimeRecoverySummary } from './runtimeRecovery'
import { i18n } from '../../i18n/runtime'

type RuntimeRecoveryNoticeContentProps = {
  summary: WorkspaceRuntimeRecoverySummary
}

export function RuntimeRecoveryNoticeContent({
  summary,
}: RuntimeRecoveryNoticeContentProps) {
  return (
    <div className="form-stack">
      <div>
        <strong>{summary.actionTitle}</strong>
      </div>
      <div>{summary.actionSummary}</div>
      <div>
        {i18n._({
          id: 'Category: {category} · Retryable: {retryable} · Runtime recycle: {recycle}',
          message:
            'Category: {category} · Retryable: {retryable} · Runtime recycle: {recycle}',
          values: {
            category: summary.categoryLabel,
            retryable: summary.retryableLabel,
            recycle: summary.recycleLabel,
          },
        })}
      </div>
      <div>{summary.description}</div>
    </div>
  )
}
